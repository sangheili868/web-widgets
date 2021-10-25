const { basename, dirname, join } = require("path");
const { copyFile, readdir, readFile, rename, rm, rmdir, mkdir, writeFile } = require("fs/promises");
const {
    execShellCommand,
    getFiles,
    getPackageInfo,
    bumpVersionInPackageJson,
    commitAndCreatePullRequest,
    updateChangelogs,
    githubAuthentication,
    cloneRepo,
    createMPK,
    createGithubRelease,
    zip,
    unzip
} = require("./module-automation/commons");

const repoRootPath = join(__dirname, "../../");
const [moduleFolderNameInRepo, version] = process.env.TAG.split("-v");

main().catch(e => {
    console.error(e);
    process.exit(-1);
});

async function main() {
    if (!moduleFolderNameInRepo || !version) {
        return;
    }

    await createDataWidgetsModule();
}

async function createDataWidgetsModule() {
    console.log("Creating the Data Widgets module.");
    const widgets = [
        "datagrid-date-filter-web",
        "datagrid-dropdown-filter-web",
        "datagrid-number-filter-web",
        "datagrid-text-filter-web",
        "datagrid-web",
        "dropdown-sort-web",
        "gallery-web",
        "tree-node-web"
    ];
    const DWFolder = join(repoRootPath, "packages/modules/data-widgets");
    const tmpFolder = join(repoRootPath, "tmp/data-widgets");
    const widgetFolders = await readdir(join(repoRootPath, "packages/pluggableWidgets"));
    const dataWidgetsFolders = widgetFolders
        .filter(folder => widgets.includes(folder))
        .map(folder => join(repoRootPath, "packages/pluggableWidgets", folder));
    let moduleInfo = {
        ...(await getPackageInfo(DWFolder)),
        moduleNameInModeler: "DataWidgets",
        moduleFolderNameInModeler: "datawidgets"
    };
    moduleInfo = await bumpVersionInPackageJson(DWFolder, moduleInfo);

    await githubAuthentication(moduleInfo);
    const moduleChangelogs = await updateChangelogs(dataWidgetsFolders, moduleInfo);
    await commitAndCreatePullRequest(moduleInfo);
    await updateTestProject(tmpFolder, dataWidgetsFolders, moduleInfo);
    const mpkOutput = await createMPK(tmpFolder, moduleInfo);

    await exportModuleWithWidgets(moduleInfo.moduleNameInModeler, mpkOutput, dataWidgetsFolders);

    await createGithubRelease(moduleInfo, moduleChangelogs, mpkOutput);
    await execShellCommand(`rm -rf ${tmpFolder}`);
    console.log("Done.");
}

// Unzip the module, copy the widget and update package.xml
async function exportModuleWithWidgets(projectName, mpkOutput, widgetsFolders) {
    const projectPath = join(dirname(mpkOutput), projectName, projectName);
    await mkdir(projectPath, { recursive: true });
    const widgetEntries = [];
    const widgetsDestination = join(projectPath, "widgets");
    // Unzip the mpk
    await unzip(mpkOutput, projectPath);
    await rmdir(mpkOutput, { recursive: true });
    // Copy widgets to widgets folder
    await mkdir(widgetsDestination, { recursive: true });
    for await (const folder of widgetsFolders) {
        const src = (await getFiles(folder, [`.mpk`]))[0];
        const dest = join(widgetsDestination, basename(src));
        widgetEntries.push(basename(src));
        await copyFile(src, dest);
    }
    // Add entries to the package.xml
    const packageXmlFile = join(projectPath, "package.xml");
    try {
        const content = (await readFile(packageXmlFile)).toString();
        if (content) {
            const filesEntry = "<files>";
            const filesContent = widgetEntries
                .map(
                    mpkFile => `
      <file path="widgets/${mpkFile}" />`
                )
                .join("");
            const [beginning, end] = content.split(filesEntry);
            const newContent = `${beginning}${filesEntry}${filesContent}${end}`;
            await writeFile(packageXmlFile, newContent);
        }
    } catch (e) {
        throw new Error("package.xml not found");
    }
    // Re-zip and rename
    await zip(projectPath, projectName);
    await rename(`${projectPath}.zip`, mpkOutput);
}

// Update test project with latest changes and update version in themesource
async function updateTestProject(tmpFolder, widgetsFolders, moduleInfo) {
    const stylesPath = join(repoRootPath, `packages/modules/${moduleFolderNameInRepo}/src/themesource`);
    const styles = await getFiles(stylesPath);
    const tmpFolderWidgets = join(tmpFolder, "widgets");
    const tmpFolderActions = join(tmpFolder, "themesource");

    console.log("Updating DataWidgets project..");
    await cloneRepo(moduleInfo.testProjectUrl, tmpFolder);

    console.log("Copying widgets and styles..");
    await Promise.all([
        ...widgetsFolders.map(async folder => {
            const src = (await getFiles(folder, [`.mpk`]))[0];
            const dest = join(tmpFolderWidgets, basename(src));
            await rm(dest);
            await copyFile(src, dest);
        }),
        ...styles.map(async file => {
            const dest = join(tmpFolderActions, file.replace(stylesPath, ""));
            await rm(dest);
            await copyFile(file, dest);
        })
    ]);
    await execShellCommand(`echo ${version} > themesource/${moduleInfo.moduleFolderNameInModeler}/.version`, tmpFolder);
    const gitOutput = await execShellCommand(`cd ${tmpFolder} && git status`);
    if (!/nothing to commit/i.test(gitOutput)) {
        await execShellCommand(`git add . && git commit -m "Updated widgets and styles" && git push`, tmpFolder);
    } else {
        console.warn(`Nothing to commit from repo ${tmpFolder}s`);
    }
}
