import { BlockRendererDefiniton, InlineModifierDefinition, InlineRendererDefiniton, ModifierFlags } from "../interface";
import { HTMLRenderType } from "./html-renderer";

const emphasisInline = new InlineModifierDefinition(
    'emphasis', ModifierFlags.Normal,
    { roleHint: 'emphasis' });

const keywordInline = new InlineModifierDefinition(
    'keyword', ModifierFlags.Normal,
    { roleHint: 'keyword' });

const highlightInline = new InlineModifierDefinition(
    'highlight', ModifierFlags.Normal,
    { roleHint: 'highlight' });

const commentaryInline = new InlineModifierDefinition(
    'commentary', ModifierFlags.Normal,
    { roleHint: 'commentary' });

export const InlineStyles = [emphasisInline, keywordInline, highlightInline, commentaryInline];

export const InlineStyleRenderersHTML = [
    [emphasisInline, (node, cxt) => {
        return `<em>${cxt.state.render(node.content, cxt)}</em>`
    }] satisfies InlineRendererDefiniton<HTMLRenderType>,
    [keywordInline, (node, cxt) => {
        return `<b>${cxt.state.render(node.content, cxt)}</b>`;
    }] satisfies InlineRendererDefiniton<HTMLRenderType>,
    [highlightInline, (node, cxt) => {
        return `<mark>${cxt.state.render(node.content, cxt)}</mark>`;
    }] satisfies InlineRendererDefiniton<HTMLRenderType>,
    [commentaryInline, (node, cxt) => {
        return `<span class='commentary'>${cxt.state.render(node.content, cxt)}</span>`;
    }] satisfies InlineRendererDefiniton<HTMLRenderType>
];