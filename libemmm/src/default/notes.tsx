import { debug } from "../debug";
import { debugPrint } from "../debug-print";
import { InlineModifierDefinition, ModifierSlotType, BlockModifierDefinition, BlockEntity, NodeType, LocationRange } from "../interface";
import { checkArguments } from "../modifier-helper";
import { ParseContext } from "../parser-config";
import { InlineRendererDefiniton } from "../renderer";
import { stripNode } from "../util";
import { HTMLComponentPlugin, HTMLRenderType } from "./html-renderer";

export const notes = Symbol();

type NoteSystem = {
    position: 'block' | 'section' | 'global',
    autonumber: boolean
}

type NoteDefinition = {
    system: string;
    name: string;
    location: LocationRange;
    content: BlockEntity[]
}

declare module '../parser-config' {
    export interface ParseContextStoreDefinitions {
        [notes]?: {
            systems: Map<string, NoteSystem>,
            definitions: NoteDefinition[]
        };
    }
}

export function initNotes(cxt: ParseContext) {
    cxt.init(notes, {
        systems: new Map(),
        definitions: []
    });
}

const noteMarkerInline = new InlineModifierDefinition<string>(
    'note', ModifierSlotType.None,
    {
        roleHint: 'link',
        prepareExpand(node) {
            let msgs = checkArguments(node, 1);
            if (msgs) return msgs;
            node.state = node.arguments[0].expansion!;
            return [];
        },
    });

const noteInline = new InlineModifierDefinition<string>(
    'note-inline', ModifierSlotType.Normal,
    {
        roleHint: 'quote',
        prepareExpand(node) {
            let msgs = checkArguments(node, 0, 1);
            if (msgs) return msgs;
            node.state = node.arguments.at(0)?.expansion ?? '';
            return [];
        },
        afterProcessExpansion(node, cxt) {
            if (node.state !== undefined) {
                cxt.get(notes)!.definitions.push({
                    system: '',
                    name: node.state,
                    location: node.location,
                    content: [{
                        type: NodeType.Paragraph,
                        location: {
                            source: node.location.source,
                            start: node.head.end,
                            end: node.location.actualEnd ?? node.location.end
                        },
                        content: node.content
                    }]
                });
            }
            return [];
        },
    });

const noteBlock = new BlockModifierDefinition<string>(
    'note', ModifierSlotType.Normal,
    {
        roleHint: 'quote',
        prepareExpand(node) {
            let msgs = checkArguments(node, 1);
            if (msgs) return msgs;
            node.state = node.arguments[0].expansion!;
            return [];
        },
        afterProcessExpansion(node, cxt) {
            if (node.state !== undefined) {
                // TODO: check if this is sound in typing
                let content = stripNode(...node.content) as BlockEntity[];
                debug.trace(`add note: system=<${''}> name=${node.state} @${node.location.start}`);
                debug.trace(`-->\n`, debugPrint.node(...content));
                cxt.get(notes)!.definitions.push({
                    system: '',
                    name: node.state,
                    location: node.location,
                    content: content
                });
            }
            // manually set expansion to nothing
            node.expansion = [];
            return [];
        },
    });

export const NoteBlocks = [noteBlock];
export const NoteInlines = [noteInline, noteMarkerInline];

export const NoteInlineRenderersHTML = [
    [noteMarkerInline, (node, cxt) => {
        if (node.state === undefined)
            return cxt.state.invalidInline(node, 'bad format');
        // find node definition
        const defs = cxt.parseContext.get(notes)!.definitions;
        const note = defs.findIndex((x) => /*x.position >= node.start &&*/ x.name == node.state);
        return <sup class='note' id={`notemarker-id-${note}`}>
                 {note < 0
                    ? `Not found: ${node.state}`
                    : <a href={`#note-id-${note}`}>${node.state}</a>}
               </sup>;
    }] satisfies InlineRendererDefiniton<HTMLRenderType, string>
];

export const NotesFooterPlugin: HTMLComponentPlugin = (cxt) => {
    const defs = cxt.parseContext.get(notes)!.definitions;
    if (defs.length == 0) return undefined;
    return [
        <hr/>,
        <section class='notes'>
            {defs.map((x, i) => 
                <section class='note' id={`note-id-${i}`}>
                    <div class='note-name'>
                        <p><a href={`#notemarker-id-${i}`}>{x.name}</a></p>
                    </div>
                    <div class='note-content'>
                        {cxt.state.render(x.content, cxt)}
                    </div>
                </section>).join('\n')}
        </section>
    ];
}