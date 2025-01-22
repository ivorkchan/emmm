import { debug } from "./debug";
import { Document, Message, MessageSeverity, DocumentNode, PositionRange, ArgumentEntity, ModifierArgument, NodeType } from "./interface";
import { ReferredMessage } from "./messages";

export function assert(x: boolean): asserts x {
    if (!!!x) {
        let error = new Error('assertion failed');
        console.log(error.stack);
        throw error; 
    }
}

export function has(v: number, f: number): boolean {
    return (v & f) === f;
}

export function linePositions(src: string): number[] {
    let result = [0];
    [...src].forEach((x, i) => {
        if (x == '\n') result.push(i+1);
    });
    result.push(Infinity);
    return result;
}

export function cloneNode(node: DocumentNode, referring?: PositionRange): DocumentNode {
    switch (node.type) {
        case NodeType.BlockModifier:
        case NodeType.InlineModifier:
        case NodeType.SystemModifier:
            return {
                start: node.start,
                end: node.end,
                type: node.type as any,
                mod: node.mod,
                state: undefined,
                head: structuredClone(node.head),
                arguments: structuredClone(node.arguments),
                content: node.content.map((x) => cloneNode(x, referring) as any),
                expansion: node.expansion ? cloneNodes(node.expansion) as any : undefined
            };
        case NodeType.Root:
        case NodeType.Paragraph:
            return {
                type: node.type as any,
                start: node.start,
                end: node.end,
                content: node.content.map((x) => cloneNode(x) as any)
            }
        case NodeType.Preformatted:
        case NodeType.Text:
        case NodeType.Escaped:
            return structuredClone(node);
        default:
            return debug.never(node);
    }
}

export function cloneNodes(nodes: DocumentNode[]): DocumentNode[] {
    return nodes.map((x) => cloneNode(x));
}

export function stripDocument(doc: Document) {
    function stripNode(node: DocumentNode): DocumentNode[] {
        switch (node.type) {
            case NodeType.Preformatted:
            case NodeType.Text:
            case NodeType.Escaped:
                return [node];
            case NodeType.BlockModifier:
            case NodeType.InlineModifier:
                if (node.expansion !== undefined)
                    return node.expansion.flatMap((x) => stripNode(x));
            case NodeType.Paragraph:
            case NodeType.Root:
                node.content = node.content.flatMap((x) => stripNode(x)) as any;
                return [node];
            case NodeType.SystemModifier:
                return [];
            default:
                return debug.never(node);
        }
    }
    doc.root = stripNode(doc.root)[0] as any;
}

function debugPrintArgEntity(node: ArgumentEntity): string {
    switch (node.type) {
        case NodeType.Text:
            return node.content;
        case NodeType.Escaped:
            return `<Escaped:${node.content}>`;
        case NodeType.Interpolation:
            return `<Interp:${node.definition.prefix}-${node.definition.postfix}:${debugPrintArgument(node.arg)}>`;
        default:
            return debug.never(node);
    }
}

export function debugPrintArgument(arg: ModifierArgument): string {
    return arg.content.map(debugPrintArgEntity).join('');
}

export function debugPrintNode(node: DocumentNode, prefix = '') {
    let result = `<${node.type}@${node.start}`;
    switch (node.type) {
        case NodeType.Root:
        case NodeType.Paragraph:
            const content = debugPrintNodes(node.content, prefix);
            if (content.length > 0)
                result += `>\n${content}\n${prefix}</${node.type}@${node.end}>`;
            else result += `-${node.end} />`;
            break;
        case NodeType.Escaped:
        case NodeType.Preformatted:
            result += `>\n${prefix}  ${node.content}\n${prefix}</${node.type}@${node.end}>`;
            break;
        case NodeType.InlineModifier:
        case NodeType.BlockModifier:
        case NodeType.SystemModifier:
            const args = node.arguments.map((x, i) => `\n${prefix}    (${i})@${x.start}-${x.end}=${debugPrintArgument(x)}`).join('')
            if (node.content.length > 0) {
                result += ` id=${node.mod.name}${args}>\n` + debugPrintNodes(node.content, prefix) + `\n${prefix}</${node.type}@${node.end}>`;
            } else result += `-${node.end} id=${node.mod.name}${args} />`;
            if (node.expansion) {
                const content = debugPrintNodes(node.expansion, prefix);
                if (content.length > 0)
                    result += `\n${prefix}<expansion>\n${content}\n${prefix}</expansion>`;
                else if (node.type != NodeType.SystemModifier)
                    result += `\n${prefix}<expansion />`;
            }
            break;
        case NodeType.Text:
            return node.content;
        default:
            return debug.never(node);
    }
    return result;
}

export function debugPrintNodes(content: DocumentNode[], prefix: string = '') {
    let dumps = content.map((x) => debugPrintNode(x, prefix + '  ')).filter((x) => x.length > 0);
    if (dumps.length == 0) return '';
    return dumps.map((x) => `${prefix}  ${x}`).join('\n');
}

export function debugDumpDocument(doc: Document, source: string): string {
    const lines = linePositions(source);

    function pos2lc(pos: number) {
        let line = -1, linepos = 0;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i] > pos) {
                line = i;
                linepos = lines[i-1];
                break;
            }
        }
        return `l${line}c${pos - linepos + 1}`;
    }

    function dumpMsg(m: Message) {
        let result = `at ${pos2lc(m.position)}, len ${m.length}: ${MessageSeverity[m.severity]}[${m.code}]: ${m.info}`;
        while (m instanceof ReferredMessage) {
            m = m.original;
            result += `\n---> original at: ${pos2lc(m.position)}, len ${m.length}`
        }
        return result;
    }

    let root = debugPrintNode(doc.root);
    let msgs = doc.messages.map(dumpMsg).join('\n');
    return `${msgs}\n${root}`;
}