import { BlockModifierDefinition, ModifierSlotType, ParagraphNode } from "../interface";
import { onlyPermitSingleBlock, onlyPermitSimpleParagraphs } from "../modifier-helper";
import { BlockRendererDefiniton } from "../renderer";
import { HTMLRenderType } from "./html-renderer";

const quoteBlock = new BlockModifierDefinition(
    'quote', ModifierSlotType.Normal,
    { roleHint: 'quote' });

const epitaphBlock = new BlockModifierDefinition(
    'epitaph', ModifierSlotType.Normal,
    { roleHint: 'quote' });

const attributionBlock = new BlockModifierDefinition<boolean>(
    'by', ModifierSlotType.Normal,
    {
        roleHint: 'quote',
        prepareExpand(node) {
            let msgs = onlyPermitSingleBlock(node);
            if (msgs) return msgs;
            msgs = onlyPermitSimpleParagraphs(node);
            if (msgs) return msgs;
            node.state = true;
            return [];
        },
    });

export const QuoteBlocks = [quoteBlock, epitaphBlock, attributionBlock];

export const QuoteBlockRenderersHTML = [
    [quoteBlock, (node, cxt) => {
        return `<blockquote>${cxt.state.render(node.content, cxt)}</blockquote>`
    }] satisfies BlockRendererDefiniton<HTMLRenderType>,
    [epitaphBlock, (node, cxt) => {
        return `<blockquote class='epitaph'>${cxt.state.render(node.content, cxt)}</blockquote>`;
    }] satisfies BlockRendererDefiniton<HTMLRenderType>,
    [attributionBlock, (node, cxt) => {
        if (!node.state)
            return cxt.state.invalidBlock(node, 'bad format');
        let para = node.content[0] as ParagraphNode;
        return `<p class='attribution'>${cxt.state.render(para.content, cxt)}</p>`;
    }] satisfies BlockRendererDefiniton<HTMLRenderType, boolean>
];