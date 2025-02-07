import { debug } from "../debug";
import { debugPrint } from "../debug-print";
import { SystemModifierDefinition, InlineEntity, ModifierFlags, Message, NodeType, ParseContext, SystemModifierNode, InlineShorthand, BlockShorthand } from "../interface";
import { NameAlreadyDefinedMessage, InvalidArgumentMessage, ArgumentCountMismatchMessage } from "../messages";
import { checkArguments } from "../modifier-helper";
import { assert } from "../util";
import { builtins, customModifier, makeInlineDefinition, ModifierSignature } from "./internal";

type ShorthandState = {
    name: string;
    parts: [string, string][];
    postfix: string | undefined;
    slotName: string | undefined;
    msgs: Message[];
};

function parseDefineArguments(
    type: NodeType.BlockModifier | NodeType.InlineModifier,
    node: SystemModifierNode<ShorthandState>,
    stack: ModifierSignature[]
) {
    const check = checkArguments(node, 1, Infinity);
    if (check) return check;
    
    const msgs: Message[] = [];
    const name = node.arguments[0];
    const nameValue = name.expansion!;

    let slotName: string | undefined = undefined;
    let parts: [string, string][] = [];
    let postfix: string | undefined = undefined;
    let i = 1;
    while (i < node.arguments.length) {
        const arg = node.arguments[i];
        const match = /^\((.*)\)$/.exec(arg.expansion!);
        if (match) {
            slotName = match[1];
            i++;
            if (type == NodeType.InlineModifier) {
                if (i < node.arguments.length) {
                    if (node.arguments[i].expansion === '') {
                        msgs.push(new InvalidArgumentMessage(
                            node.arguments[i].start, node.arguments[i].end, 'postfix'));
                    } else {
                        postfix = node.arguments[i].expansion!;
                        i++;
                    }
                } else msgs.push(
                    new ArgumentCountMismatchMessage(node.start, node.end));
            }
            break;
        }
        
        i++;
        if (i < node.arguments.length) {
            parts.push([arg.expansion!, node.arguments[i].expansion!]);
            i++;
        } else {
            msgs.push(new ArgumentCountMismatchMessage(node.start, node.end));
            break;
        }
    }
    
    if (i == node.arguments.length - 1) {
        const last = node.arguments[i];
        if (last.expansion !== '') msgs.push(
            new InvalidArgumentMessage(last.start, last.end, '(must be empty)'));
    } else if (i < node.arguments.length - 1)
        msgs.push(new ArgumentCountMismatchMessage(node.start, node.end));

    node.state = { name: nameValue, slotName, parts, postfix, msgs };
    if (slotName !== undefined)
        stack.push({ slotName, args: parts.map((x) => x[0]) });
    return [];
}

export const DefineBlockShorthandMod = new SystemModifierDefinition
    <ShorthandState>
    ('block-shorthand', ModifierFlags.Normal, 
{
    // -inline-shorthand prefix:arg1:part1:arg2:part2...:(slot):postfix:
    delayContentExpansion: true,
    alwaysTryExpand: true,
    beforeParseContent(node, cxt) {
        const store = cxt.get(builtins)!;
        const check = parseDefineArguments(NodeType.BlockModifier, 
            node, store.blockSlotDelayedStack);
        if (check) return check;
        debug.trace('entering block shorthand definition', node.state!.name);
        return [];
    },
    afterParseContent(node, cxt) {
        if (node.state?.slotName === undefined) return [];
        const store = cxt.get(builtins)!;
        assert(store.blockSlotDelayedStack.pop()?.slotName == node.state.slotName);
        debug.trace('leaving inline shorthand definition', node.state.name);
        return [];
    },
    prepareExpand(node, cxt, immediate) {
        if (!immediate || !node.state) return [];
        const arg = node.arguments[0];
        if (!node.state) 
            return [new InvalidArgumentMessage(arg.start, arg.end)];
        const msgs = node.state.msgs;
        if (cxt.config.blockShorthands.has(node.state.name))
            msgs.push(new NameAlreadyDefinedMessage(arg.start, arg.end, node.state.name));
        return msgs;
    },
    expand(node, cxt, immediate) {
        if (!immediate || !node.state) return undefined;
        const name = '<block shorthand>';
        const args = node.state.parts.map((x) => x[0]);
        const parts = node.state.parts.map((x) => x[1]);
        const mod = customModifier(NodeType.BlockModifier, name, 
            (node.state.slotName !== undefined) ? ModifierFlags.Normal : ModifierFlags.Marker,
            args, node.state.slotName ?? '', node.content);
        const shorthand: BlockShorthand<any> = {
            name: node.state.name,
            postfix: node.state.postfix,
            mod, parts
        };
        cxt.config.blockShorthands.add(shorthand);
        debug.info(() => 'created block shorthand: ' + debugPrint.blockShorthand(shorthand));
        return [];
    },
});

export const DefineInlineShorthandMod = new SystemModifierDefinition
    <ShorthandState & { definition?: InlineEntity[]; }>
    ('inline-shorthand', ModifierFlags.Normal, 
{
    // -inline-shorthand prefix:arg1:part1:arg2:part2...:(slot):postfix:
    delayContentExpansion: true,
    alwaysTryExpand: true,
    beforeParseContent(node, cxt) {
        const store = cxt.get(builtins)!;
        const check = parseDefineArguments(NodeType.InlineModifier, 
            node, store.inlineSlotDelayedStack);
        if (check) return check;
        debug.trace('entering inline shorthand definition', node.state!.name);
        return [];
    },
    afterParseContent(node, cxt) {
        if (node.state?.slotName === undefined) return [];
        const store = cxt.get(builtins)!;
        assert(store.inlineSlotDelayedStack.pop()?.slotName == node.state.slotName);
        debug.trace('leaving inline shorthand definition', node.state.name);
        return [];
    },
    prepareExpand(node, cxt, immediate) {
        if (!immediate || !node.state) return [];
        const arg = node.arguments[0];
        if (!node.state) 
            return [new InvalidArgumentMessage(arg.start, arg.end)];
        const msgs = node.state.msgs;
        if (cxt.config.inlineShorthands.has(node.state.name))
            msgs.push(new NameAlreadyDefinedMessage(arg.start, arg.end, node.state.name));
        node.state.definition = makeInlineDefinition(node, msgs);
        return msgs;
    },
    expand(node, cxt, immediate) {
        if (!immediate || !node.state) return undefined;
        const name = '<inline shorthand>';
        const args = node.state.parts.map((x) => x[0]);
        const parts = node.state.parts.map((x) => x[1]);
        const mod = customModifier(NodeType.InlineModifier, name, 
            (node.state.slotName !== undefined) ? ModifierFlags.Normal : ModifierFlags.Marker,
            args, node.state.slotName ?? '', 
            node.state.definition!);
        const shorthand: InlineShorthand<any> = {
            name: node.state.name,
            postfix: node.state.postfix,
            mod, parts
        };
        cxt.config.inlineShorthands.add(shorthand);
        debug.info(() => 'created inline shorthand: ' + debugPrint.inlineShorthand(shorthand));
        return [];
    },
});