import { debug } from "./debug";
import { BlockEntity, BlockModifierDefinition, BlockModifierNode, Configuration, Document, EscapedNode, InlineEntity, InlineModifierDefinition, InlineModifierNode, Message, ModifierArgument, ModifierFlags, ParagraphNode, ParseContext, PositionRange, PreNode, RootNode, Scanner, ArgumentEntity, ArgumentInterpolatorDefinition, ModifierNode, SystemModifierDefinition, SystemModifierNode } from "./interface";
import { ContentShouldBeOnNewlineMessage, ExpectedMessage, NewBlockShouldBeOnNewlineMessage, ReachedRecursionLimitMessage as ReachedReparseLimitMessage, ReferredMessage, UnclosedInlineModifierMessage, UnknownModifierMessage, UnnecessaryNewlineMessage } from "./messages";
import { assert, debugPrintNodes, has } from "./util";

const GROUP_BEGIN = ':--';
const GROUP_END = '--:';

const MODIFIER_BLOCK_OPEN = '[.';
const MODIFIER_CLOSE_SIGN = ']';
const MODIFIER_END_SIGN = ';';

const MODIFIER_INLINE_OPEN = '[/';
const MODIFIER_INLINE_END_TAG = '[;]';

const MODIFIER_SYSTEM_OPEN = '[-';

const UnknownModifier = {
    block: new BlockModifierDefinition('UNKNOWN', ModifierFlags.Normal),
    inline: new InlineModifierDefinition('UNKNOWN', ModifierFlags.Normal),
    system: new SystemModifierDefinition('UNKNOWN', ModifierFlags.Normal)
};

type NodeWithBlockContent = 
    RootNode | BlockModifierNode<unknown> | SystemModifierNode<unknown>;
type NodeWithInlineContent = 
    InlineModifierNode<unknown> | ParagraphNode;

class EmitEnvironment {
    public root: RootNode = {type: 'root', start: 0, end: -1, content: []};
    public messages: Message[] = [];
    private blockStack: NodeWithBlockContent[] = [this.root];
    private inlineStack: NodeWithInlineContent[] = [];
    private referringStack: PositionRange[] = [];

    constructor(private scanner: Scanner) {}

    message(...m: Message[]) {
        const referringReverse = [...this.referringStack].reverse();
        for (let msg of m) {
            for (const range of referringReverse)
                msg = new ReferredMessage(msg, range.start, range.end - range.start);
            this.messages.push(msg);
            debug.trace('issued msg', msg.code, msg.info);
        }
    }

    pushReferring(start: number, end: number) {
        this.referringStack.push({start, end});
    }

    popReferring() {
        assert(this.referringStack.length > 0);
        this.referringStack.pop();
    }

    addBlockNode(n: BlockEntity) {
        assert(this.blockStack.length > 0);
        this.blockStack.at(-1)!.content.push(n);
        return n;
    }

    addInlineNode(n: InlineEntity) {
        assert(this.inlineStack.length > 0);
        this.inlineStack.at(-1)!.content.push(n);
        return n;
    }

    addString(str: string) {
        assert(this.inlineStack.length > 0);
        const content = this.inlineStack.at(-1)!.content;
        const last = content.at(-1);
        if (last?.type == 'text') {
            last.content += str;
            last.end = this.scanner.position();
        } else content.push({
            type: 'text',
            start: this.scanner.position() - str.length,
            end: this.scanner.position(),
            content: str
        });
    }

    startBlock(block: BlockModifierNode<unknown> | SystemModifierNode<unknown>) {
        this.addBlockNode(block);
        this.blockStack.push(block);
    }

    endBlock() {
        assert(this.blockStack.length >= 2);
        const node = this.blockStack.pop()!;
        node.end = this.scanner.position();
    }

    startInline(n: InlineModifierNode<unknown> | ParagraphNode) {
        if (n.type == 'paragraph') this.addBlockNode(n);
        else this.addInlineNode(n);
        this.inlineStack.push(n);
    }

    endInline() {
        assert(this.inlineStack.length > 0);
        const node = this.inlineStack.pop()!;
        node.end = this.scanner.position();
    }
}

class Parser {
    private emit: EmitEnvironment;
    private cxt: ParseContext;
    private groupDepth = 0;
    private prefixes = {
        block: [] as [string, BlockModifierDefinition<any>][],
        inline: [] as  [string, InlineModifierDefinition<any>][],
        system: [] as  [string, SystemModifierDefinition<any>][],
        interpolator: [] as  [string, ArgumentInterpolatorDefinition][]
    }
    

    constructor(private scanner: Scanner, config: Configuration) {
        this.emit = new EmitEnvironment(scanner);
        this.cxt = new ParseContext(config);
        this.cxt.onConfigChange = () => this.#sortModifiers();
        this.#sortModifiers();
    }

    #sortModifiers() {
        this.prefixes.block = [...this.cxt.config.blockModifiers.entries()]
            .sort(([x, _], [y, __]) => y.length - x.length);
        this.prefixes.inline = [...this.cxt.config.inlineModifiers.entries()]
            .sort(([x, _], [y, __]) => y.length - x.length);
        this.prefixes.system = [...this.cxt.config.systemModifiers.entries()]
            .sort(([x, _], [y, __]) => y.length - x.length);
        this.prefixes.interpolator = [...this.cxt.config.argumentInterpolators.entries()]
            .sort(([x, _], [y, __]) => y.length - x.length);
        debug.trace(this.cxt.config.argumentInterpolators);
    }

    #reparse(nodes: (BlockEntity | InlineEntity)[], depth: number): boolean {
        if (depth > this.cxt.config.reparseDepthLimit) return false;
        let ok = true;
        for (const node of nodes) {
            switch (node.type) {
                case "pre":
                case "text":
                case "escaped":
                    continue;
                case "paragraph":
                    ok = this.#reparse(node.content, depth + 1) && ok;
                    continue;
                case "block":
                case "inline":
                case "system":
                    ok = this.#expand(node, depth + 1) && ok;
                    continue;
                default:
                    debug.never(node);
            }
        }
        return ok;
    }

    #expand(node: ModifierNode, depth = 0) {
        if (node.expansion !== undefined) {
            debug.trace('already expanded, skipping:', node.mod.name);
            return true;
        }
        if (this.cxt.delayDepth > 0 && !node.mod.alwaysTryExpand) {
            debug.trace('delaying expansion of', node.mod.name);
            return true;
        }

        if (node.content.length > 0 && depth > 0) {
            // simulate initial parse for generated content
            if (node.mod.beforeParseContent)
                this.emit.message(...node.mod.beforeParseContent(node as any, this.cxt));
            if (node.mod.delayContentExpansion) this.cxt.delayDepth++;
            this.#reparse(node.content, depth);
            if (node.mod.delayContentExpansion) this.cxt.delayDepth--;
            if (node.mod.afterParseContent)
                this.emit.message(...node.mod.afterParseContent(node as any, this.cxt));
        }

        if (node.mod.prepareExpand)
            this.emit.message(...node.mod.prepareExpand(node as any, this.cxt));
        if (node.mod.expand) {
            node.expansion = node.mod.expand(node as any, this.cxt);
            if (!node.expansion) {
                return true;
            } else if (node.expansion.length > 0) {
                debug.trace(`${this.cxt.delayDepth > 0 ? 'early ' : ''}expanding:`, node.mod.name);
                debug.trace(() => '-->\n' + debugPrintNodes(node.expansion!, '  '));
            } else {
                debug.trace(`${this.cxt.delayDepth > 0 ? 'early ' : ''}expanding:`, node.mod.name);
            }
        }

        const expansion = node.expansion ?? node.content;
        if (expansion.length == 0) return true;
        if (node.mod.beforeProcessExpansion)
            this.emit.message(...node.mod.beforeProcessExpansion(node as any, this.cxt));

        this.emit.pushReferring(node.start, node.end);
        let ok = this.#reparse(expansion, depth);
        this.emit.popReferring();

        if (node.mod.afterProcessExpansion)
            this.emit.message(...node.mod.afterProcessExpansion(node as any, this.cxt));
        if (!ok && depth == 0) {
            const limit = this.cxt.config.reparseDepthLimit;
            this.emit.message(new ReachedReparseLimitMessage(
                node.start, node.end - node.start, limit, node.mod.name));
        }
        return ok;
    }

    parse() {
        this.DOCUMENT();
        return new Document(this.emit.root, this.cxt, this.emit.messages);
    }

    private WHITESPACES_OR_NEWLINES() {
        while (this.scanner.acceptWhitespaceChar() !== null
            || this.scanner.accept('\n')) {}
    }

    private SHOULD_BE_A_NEWLINE() {
        while (this.scanner.acceptWhitespaceChar() !== null) { }
        if (!this.scanner.accept('\n')) this.emit.message(
            new ContentShouldBeOnNewlineMessage(this.scanner.position()));
    }

    // TODO: this is awkward and doesn't emit messages in the most appropriate way
    private WARN_IF_MORE_NEWLINES_THAN(n: number) {
        let nlines = 0;
        const start = this.scanner.position();
        while (true) {
            if (this.scanner.accept('\n')) {
                nlines++;
                continue;
            }
            if (this.scanner.acceptWhitespaceChar() == null) break;
        }
        const end = this.scanner.position();
        if (nlines > n) this.emit.message(
            new UnnecessaryNewlineMessage(start, end - start));
    }

    private DOCUMENT() {
        this.WHITESPACES_OR_NEWLINES();
        while (!this.scanner.isEOF()) {
            this.BLOCK_ENTITY();
            this.WHITESPACES_OR_NEWLINES();
        }
    }

    private BLOCK_ENTITY() {
        assert(!this.scanner.isEOF());
        if (this.scanner.peek(MODIFIER_BLOCK_OPEN)) {
            this.MODIFIER('block');
            return;
        }
        if (this.scanner.peek(MODIFIER_SYSTEM_OPEN)) {
            this.MODIFIER('system');
            return;
        }
        // simple paragraph(s)
        this.MAYBE_GROUPED_PARAGRAPH();
    }

    private MODIFIER(type: 'block' | 'system' | 'inline') {
        const posStart = this.scanner.position();
        assert(this.scanner.accept({
            block: MODIFIER_BLOCK_OPEN,
            system: MODIFIER_SYSTEM_OPEN,
            inline: MODIFIER_INLINE_OPEN
        }[type]));

        const result = this.prefixes[type].find(([name, _]) => this.scanner.accept(name));
        const mod = result ? result[1] : UnknownModifier[type];
        if (result === undefined) {
            const args = this.scanner.acceptUntil(MODIFIER_CLOSE_SIGN);
            if (args === null) this.emit.message(
                new ExpectedMessage(this.scanner.position(), MODIFIER_CLOSE_SIGN));
            this.emit.message(
                new UnknownModifierMessage(posStart, this.scanner.position() - posStart));
        }
        const args = this.ARGUMENTS();
        debug.trace(`PARSE ${type} modifier:`, mod.name);

        const endsign = this.scanner.accept(MODIFIER_END_SIGN);
        const flagMarker = has(mod.flags, ModifierFlags.Marker);
        const isMarker = flagMarker || endsign;
        if (!this.scanner.accept(MODIFIER_CLOSE_SIGN))
            this.emit.message(new ExpectedMessage(
                this.scanner.position(), MODIFIER_CLOSE_SIGN));

        const node: ModifierNode = {
            type: type as any, 
            mod: mod as any,
            head: {start: posStart, end: this.scanner.position()},
            arguments: args,
            start: posStart,
            end: -1,
            content: [],
            expansion: undefined
        };

        if (node.mod.beforeParseContent)
            this.emit.message(...node.mod.beforeParseContent(node as any, this.cxt));
        if (node.mod.delayContentExpansion) this.cxt.delayDepth++;

        let ok = true;
        if (isMarker) {
            if (type == 'inline') this.emit.addInlineNode(node as any);
            else this.emit.addBlockNode(node as any);
        } else if (type == 'inline') {
            this.emit.startInline(node as any);
            const entity = has(mod.flags, ModifierFlags.Preformatted)
                ? this.PREFORMATTED_INLINE_ENTITY.bind(this)
                : this.INLINE_ENTITY.bind(this);
            while (true) {
                if (this.scanner.accept(MODIFIER_INLINE_END_TAG)) break;
                if (this.scanner.isEOF() || !(ok = entity())) {
                    this.emit.message(new UnclosedInlineModifierMessage(
                        this.scanner.position(), mod.name));
                    break;
                }
            }
            this.emit.endInline();
        } else {
            this.emit.startBlock(node as any);
            this.WARN_IF_MORE_NEWLINES_THAN(1);
            if (!this.scanner.isEOF()) {
                if (has(mod.flags, ModifierFlags.Preformatted))
                    this.PRE_PARAGRAPH();
                else
                    this.BLOCK_ENTITY();
            }
            this.emit.endBlock();
        }
        if (node.mod.delayContentExpansion) this.cxt.delayDepth--;
        if (node.mod.afterParseContent)
            this.emit.message(...node.mod.afterParseContent(node as any, this.cxt));
        this.#expand(node);
        return ok;
    }

    // also handles "grouped" (delimited) pre-paragraphs
    private PRE_PARAGRAPH() {
        assert(!this.scanner.isEOF());
        const posStart = this.scanner.position();
        const grouped = this.scanner.accept(GROUP_BEGIN);
        if (grouped) this.SHOULD_BE_A_NEWLINE();
        const posContentStart = this.scanner.position();
        let posContentEnd = this.scanner.position();

        let string = '';
        while (!this.scanner.isEOF()) {
            if (this.scanner.accept('\n')) {
                let white = "\n";
                let char: string | null = "";
                while ((char = this.scanner.acceptWhitespaceChar()) !== null)
                    white += char;
                    
                if  ((grouped && this.scanner.accept(GROUP_END)) 
                 || (!grouped && this.scanner.accept('\n'))) break;

                if (this.scanner.isEOF()) {
                    if (grouped) this.emit.message(new ExpectedMessage(
                        this.scanner.position(), GROUP_END));
                    break;
                }
                string += white;
            } else {
                string += this.scanner.acceptChar();
            }
            posContentEnd = this.scanner.position();
        }
        const node: PreNode = {
            type: 'pre', 
            start: posStart,
            end: this.scanner.position(),
            content: {
                start: posContentStart,
                end: posContentEnd,
                text: string
            }
        };
        this.emit.addBlockNode(node);
    }

    private MAYBE_GROUPED_PARAGRAPH() {
        assert(!this.scanner.isEOF());
        if (this.scanner.accept(GROUP_BEGIN)) {
            this.groupDepth++;
            this.SHOULD_BE_A_NEWLINE();
            this.WARN_IF_MORE_NEWLINES_THAN(1);
            while (!this.scanner.isEOF()) {
                if (this.scanner.accept(GROUP_END)) {
                    this.groupDepth--;
                    return;
                }
                this.BLOCK_ENTITY();
                this.WARN_IF_MORE_NEWLINES_THAN(1);
            }
            // EOF
            this.emit.message(new ExpectedMessage(
                this.scanner.position(), GROUP_END))
        } else {
            this.PARAGRAPH();
        }
    }

    private PARAGRAPH() {
        assert(!this.scanner.isEOF());
        const node: ParagraphNode = {
            type: 'paragraph',
            start: this.scanner.position(),
            end: -1,
            content: []
        };
        debug.trace('PARSE para');
        this.emit.startInline(node);
        while (!this.scanner.isEOF() && this.INLINE_ENTITY()) {}
        this.emit.endInline();
        debug.trace('PARSE para end');
    }

    // returns false if breaking out of paragraph
    private INLINE_ENTITY(): boolean {
        assert(!this.scanner.isEOF());
        if (this.scanner.peek(MODIFIER_BLOCK_OPEN)) 
        {
            this.emit.message(new NewBlockShouldBeOnNewlineMessage(this.scanner.position()))
            return false;
        }
        if (this.scanner.peek(MODIFIER_INLINE_OPEN)) {
            return this.MODIFIER('inline');
        }
        if (this.scanner.peek(MODIFIER_SYSTEM_OPEN)) {
            return false;
        }

        // TODO: don't know if this is enough
        if (this.scanner.accept('\\')) {
            if (this.scanner.isEOF()) {
                this.emit.addString('\\');
                return true;
            }
            const node: EscapedNode = {
                type: 'escaped',
                start: this.scanner.position() - 1,
                content: this.scanner.acceptChar(),
                end: this.scanner.position()
            };
            this.emit.addInlineNode(node);
            return true;
        }
        return this.PREFORMATTED_INLINE_ENTITY();
    }

    // returns false if breaking out of paragraph
    private PREFORMATTED_INLINE_ENTITY(): boolean {
        assert(!this.scanner.isEOF());
        if (this.scanner.accept('\n')) {
            // these whitespaces in a blank line have no effect
            while (this.scanner.acceptWhitespaceChar() !== null) {}
            if  (this.scanner.peek(MODIFIER_BLOCK_OPEN)
             ||  this.scanner.peek(MODIFIER_SYSTEM_OPEN)
             || (this.scanner.peek(GROUP_END) && this.groupDepth > 0)
             ||  this.scanner.isEOF()) return false;

            if (this.scanner.accept('\n')) {
                this.WARN_IF_MORE_NEWLINES_THAN(0);
                return false;
            }
            this.emit.addString('\n');
            return true;
        }
        // simple character
        this.emit.addString(this.scanner.acceptChar());
        return true;
    }

    private ARGUMENT_CONTENT(end?: string): [ModifierArgument, boolean] {
        let ok = true;
        const content: ArgumentEntity[] = [];
        const posStart = this.scanner.position();
        let posEnd = this.scanner.position();

        const emitString = (s: string) => {
            const last = content.at(-1);
            if (last?.type == 'text') {
                last.content += s;
                last.end += s.length;
            } else {
                const end = this.scanner.position();
                content.push({
                    type: 'text', 
                    end, start: end - s.length,
                    content: s
                });
            }
        };

        while (true) {
            if (end !== undefined && this.scanner.accept(end)) {
                debug.trace('found end', end);
                break;
            }
            if (this.scanner.accept(':')) {
                ok = (end === undefined);
                break;
            }
            if (this.scanner.peek(MODIFIER_END_SIGN)
             || this.scanner.peek(MODIFIER_CLOSE_SIGN)
             || this.scanner.isEOF())
            {
                ok = false;
                break;
            }

            if (this.scanner.accept('\\')) {
                // handle escaping
                posEnd = this.scanner.position();
                if (this.scanner.isEOF()) {
                    emitString('\\');
                    ok = false;
                    break;
                }
                content.push({
                    type: 'escaped',
                    content: this.scanner.acceptChar(),
                    start: posEnd - 2, end: posEnd
                });
                continue;
            }
            const result = this.prefixes.interpolator.find(([x, _]) => this.scanner.accept(x));
            if (result !== undefined) {
                const [inner, ok2] = this.ARGUMENT_CONTENT(result[1].postfix);
                posEnd = this.scanner.position();
                content.push({
                    type: 'interp',
                    definition: result[1], arg: inner,
                    start: posEnd - 2, end: posEnd
                });
                if (!ok2) {
                    this.emit.message(new ExpectedMessage(posEnd, result[1].postfix));
                    ok = false;
                    break;
                }
            } else {
                emitString(this.scanner.acceptChar());
                posEnd = this.scanner.position();
            }
        }
        return [{
            start: posStart, end: posEnd,
            content
        }, ok];
    }

    private ARGUMENTS(): ModifierArgument[] {
        // optionally accept semicolon before first argument
        const firstSemicolon = this.scanner.accept(':');
        // don't eat whites if there is a first semicolon
        if (!firstSemicolon) this.WHITESPACES_OR_NEWLINES();

        const list: ModifierArgument[] = [];
        let end = false;
        while (!end) {
            const [arg, ok] = this.ARGUMENT_CONTENT();
            if (!ok) {
                end = true;
                // if we haven't parsed anything so far: if there is no first semicolon, there's no arguments; otherwise, there is a single empty argument
                if (list.length == 0 && arg.content.length == 0 && !firstSemicolon)
                    break;
            }
            list.push(arg);
        }
        return list;
    }
}

export function parse(scanner: Scanner, config: Configuration) {
    return new Parser(scanner, config).parse();
}