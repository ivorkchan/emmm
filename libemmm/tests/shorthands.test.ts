import { describe, expect, test } from "vitest";
import { BuiltinConfiguration } from "../src/builtin/builtin";
import { SimpleScanner } from "../src/scanner";
import * as Parser from "../src/parser";
import { BlockModifierDefinition, ModifierSlotType, NodeType } from "../src/interface";
import { debug, DebugLevel } from "../src/debug";
import { Configuration, ParseContext } from "../src/parser-config";

const TestConfig = Configuration.from(BuiltinConfiguration);
TestConfig.blockModifiers.add(
    new BlockModifierDefinition('normal', ModifierSlotType.Normal)
);

function parse(src: string) {
    const config = Configuration.from(TestConfig);
    let doc = Parser.parse(new SimpleScanner(src), new ParseContext(config)).toStripped();
    return doc;
}
debug.level = DebugLevel.Warning;

describe('inline shorthands', () => {
    test('literal and empty', () => {
        let doc = parse(`[-inline-shorthand p] 123\n\np`);
        expect.soft(doc.messages).toMatchObject([]);
        expect.soft(doc.root.content).toMatchObject([
            { type: NodeType.Paragraph, content: [{ type: NodeType.Text, content: '123' }] }
        ]);
        doc = parse(`[-inline-shorthand p;]\n\np`);
        expect.soft(doc.messages).toMatchObject([]);
        expect.soft(doc.root.content).toMatchObject([
            { type: NodeType.Paragraph, content: [] }
        ]);
    });
    test('arguments: reference (interp)', () => {
        let doc = parse(`[-inline-shorthand p:x:p][/print $(x)]\n\np1p`);
        expect.soft(doc.messages).toMatchObject([]);
        expect.soft(doc.root.content).toMatchObject([
            { type: NodeType.Paragraph, content: [{ type: NodeType.Text, content: '1' }] }
        ]);
    });
    test('arguments: reference (modifier)', () => {
        let doc = parse(`[-inline-shorthand p:x:p][/$x]\n\np1p`);
        expect.soft(doc.messages).toMatchObject([]);
        expect.soft(doc.root.content).toMatchObject([
            { type: NodeType.Paragraph, content: [{ type: NodeType.Text, content: '1' }] }
        ]);
    });
});