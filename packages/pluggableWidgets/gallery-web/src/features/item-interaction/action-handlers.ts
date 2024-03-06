import { ElementEntry, EventCaseEntry } from "@mendix/widget-plugin-grid/event-switch/base";
import { ExecuteActionFx } from "../../helpers/ClickActionHelper";
import { EventEntryContext } from "./base";
import { onOwnSpaceKeyDown } from "@mendix/widget-plugin-grid/selection";

const onClick = (execActionFx: ExecuteActionFx): EventCaseEntry<EventEntryContext, HTMLDivElement, "onClick"> => ({
    eventName: "onClick",
    filter: () => {
        return true;
    },
    handler: ({ item }) => execActionFx(item)
});

const canExecOnSpaceOrEnter = (_ctx: EventEntryContext, event: React.KeyboardEvent): boolean => {
    if (event.code === "Space") {
        return !event.shiftKey;
    }

    return event.code === "Enter";
};

const onSpaceOrEnter = (
    execActionFx: ExecuteActionFx
): [
    EventCaseEntry<EventEntryContext, HTMLDivElement, "onKeyDown">,
    EventCaseEntry<EventEntryContext, HTMLDivElement, "onKeyUp">
] => {
    let pressed = false;
    return [
        {
            eventName: "onKeyDown",
            filter: canExecOnSpaceOrEnter,
            handler: () => (pressed = true)
        },
        {
            eventName: "onKeyUp",
            filter: (ctx, event) => canExecOnSpaceOrEnter(ctx, event) && pressed,
            handler: ({ item }) => {
                pressed = false;
                execActionFx(item);
            }
        }
    ];
};

export function createActionHandlers(
    execActionFx: ExecuteActionFx
): Array<ElementEntry<EventEntryContext, HTMLDivElement>> {
    return [
        onClick(execActionFx),
        onOwnSpaceKeyDown(e => {
            e.preventDefault();
            e.stopPropagation();
        }),
        ...onSpaceOrEnter(execActionFx)
    ];
}
