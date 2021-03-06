// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { NodeIdMap, ParseContext, ParseContextUtils, ParseError } from "..";
import { Assert, CommonError } from "../../common";
import { Ast, Constant, Token } from "../../language";
import { LexerSnapshot } from "../../lexer";
import { getLocalizationTemplates } from "../../localization";
import { ParseSettings } from "../../settings";
import { NodeIdMapUtils } from "../nodeIdMap";
import { IParserState } from "./IParserState";

export interface FastStateBackup {
    readonly tokenIndex: number;
    readonly contextStateIdCounter: number;
    readonly maybeContextNodeId: number | undefined;
}

// ---------------------------
// ---------- State ----------
// ---------------------------

// If you have a custom parser + parser state, then you'll have to create your own factory function.
// See `benchmark.ts` for an example.
export function stateFactory<S extends IParserState = IParserState>(
    settings: ParseSettings<S>,
    lexerSnapshot: LexerSnapshot,
): IParserState {
    const maybeCurrentToken: Token.Token | undefined = lexerSnapshot.tokens[0];

    return {
        ...settings,
        localizationTemplates: getLocalizationTemplates(settings.locale),
        maybeCancellationToken: settings.maybeCancellationToken,
        lexerSnapshot,
        tokenIndex: 0,
        maybeCurrentToken,
        maybeCurrentTokenKind: maybeCurrentToken?.kind,
        contextState: ParseContextUtils.newState(),
        maybeCurrentContextNode: undefined,
    };
}

export function applyState(originalState: IParserState, otherState: IParserState): void {
    originalState.tokenIndex = otherState.tokenIndex;
    originalState.maybeCurrentToken = otherState.maybeCurrentToken;
    originalState.maybeCurrentTokenKind = otherState.maybeCurrentTokenKind;

    originalState.contextState = otherState.contextState;
    originalState.maybeCurrentContextNode = otherState.maybeCurrentContextNode;
}

// Due to performance reasons the backup no longer can include a naive deep copy of the context state.
// Instead it's assumed that a backup is made immediately before a try/catch read block.
// This means the state begins in a parsing context and the backup will either be immediately consumed or dropped.
// Therefore we only care about the delta between before and after the try/catch block.
// Thanks to the invariants above and the fact the ids for nodes are an auto-incrementing integer
// we can easily just drop all delete all context nodes past the id of when the backup was created.
export function fastStateBackup(state: IParserState): FastStateBackup {
    return {
        tokenIndex: state.tokenIndex,
        contextStateIdCounter: state.contextState.idCounter,
        maybeContextNodeId: state.maybeCurrentContextNode?.id,
    };
}

// See state.fastSnapshot for more information.
export function applyFastStateBackup(state: IParserState, backup: FastStateBackup): void {
    state.tokenIndex = backup.tokenIndex;
    state.maybeCurrentToken = state.lexerSnapshot.tokens[state.tokenIndex];
    state.maybeCurrentTokenKind = state.maybeCurrentToken?.kind;

    const contextState: ParseContext.State = state.contextState;
    const nodeIdMapCollection: NodeIdMap.Collection = state.contextState.nodeIdMapCollection;
    const backupIdCounter: number = backup.contextStateIdCounter;
    contextState.idCounter = backupIdCounter;

    const newContextNodeIds: number[] = [];
    const newAstNodeIds: number[] = [];
    for (const nodeId of nodeIdMapCollection.astNodeById.keys()) {
        if (nodeId > backupIdCounter) {
            newAstNodeIds.push(nodeId);
        }
    }
    for (const nodeId of nodeIdMapCollection.contextNodeById.keys()) {
        if (nodeId > backupIdCounter) {
            newContextNodeIds.push(nodeId);
        }
    }

    const sortByNumber: (left: number, right: number) => number = (left: number, right: number) => left - right;
    for (const nodeId of newAstNodeIds.sort(sortByNumber).reverse()) {
        const maybeParentId: number | undefined = nodeIdMapCollection.parentIdById.get(nodeId);
        const parentWillBeDeleted: boolean = maybeParentId !== undefined && maybeParentId >= backupIdCounter;
        ParseContextUtils.deleteAst(state.contextState, nodeId, parentWillBeDeleted);
    }
    for (const nodeId of newContextNodeIds.sort(sortByNumber).reverse()) {
        ParseContextUtils.deleteContext(state.contextState, nodeId);
    }

    if (backup.maybeContextNodeId) {
        state.maybeCurrentContextNode = NodeIdMapUtils.assertGetContext(
            state.contextState.nodeIdMapCollection.contextNodeById,
            backup.maybeContextNodeId,
        );
    } else {
        state.maybeCurrentContextNode = undefined;
    }
}

export function startContext(state: IParserState, nodeKind: Ast.NodeKind): void {
    const newContextNode: ParseContext.Node = ParseContextUtils.startContext(
        state.contextState,
        nodeKind,
        state.tokenIndex,
        state.maybeCurrentToken,
        state.maybeCurrentContextNode,
    );
    state.maybeCurrentContextNode = newContextNode;
}

export function endContext(state: IParserState, astNode: Ast.TNode): void {
    Assert.isDefined(state.maybeCurrentContextNode, `can't end a context if one doesn't exist`);

    const maybeParentOfContextNode: ParseContext.Node | undefined = ParseContextUtils.endContext(
        state.contextState,
        state.maybeCurrentContextNode,
        astNode,
    );
    state.maybeCurrentContextNode = maybeParentOfContextNode;
}

export function deleteContext(state: IParserState, maybeNodeId: number | undefined): void {
    let nodeId: number;
    if (maybeNodeId === undefined) {
        Assert.isDefined(state.maybeCurrentContextNode, `can't delete a context if one doesn't exist`);
        const currentContextNode: ParseContext.Node = state.maybeCurrentContextNode;
        nodeId = currentContextNode.id;
    } else {
        nodeId = maybeNodeId;
    }

    state.maybeCurrentContextNode = ParseContextUtils.deleteContext(state.contextState, nodeId);
}

export function incrementAttributeCounter(state: IParserState): void {
    Assert.isDefined(state.maybeCurrentContextNode, `state.maybeCurrentContextNode`);
    const currentContextNode: ParseContext.Node = state.maybeCurrentContextNode;
    currentContextNode.attributeCounter += 1;
}

// -------------------------
// ---------- IsX ----------
// -------------------------

export function isTokenKind(state: IParserState, tokenKind: Token.TokenKind, tokenIndex: number): boolean {
    return state.lexerSnapshot.tokens[tokenIndex]?.kind === tokenKind ?? false;
}

export function isNextTokenKind(state: IParserState, tokenKind: Token.TokenKind): boolean {
    return isTokenKind(state, tokenKind, state.tokenIndex + 1);
}

export function isOnTokenKind(
    state: IParserState,
    tokenKind: Token.TokenKind,
    tokenIndex: number = state.tokenIndex,
): boolean {
    return isTokenKind(state, tokenKind, tokenIndex);
}

export function isOnConstantKind(state: IParserState, constantKind: Constant.TConstantKind): boolean {
    if (isOnTokenKind(state, Token.TokenKind.Identifier)) {
        const currentToken: Token.Token = state.lexerSnapshot.tokens[state.tokenIndex];
        if (currentToken?.data === undefined) {
            const details: {} = { currentToken };
            throw new CommonError.InvariantError(`expected data on Token`, details);
        }

        const data: string = currentToken.data;
        return data === constantKind;
    } else {
        return false;
    }
}

export function isOnGeneralizedIdentifierStart(state: IParserState, tokenIndex: number = state.tokenIndex): boolean {
    const maybeTokenKind: Token.TokenKind | undefined = state.lexerSnapshot.tokens[tokenIndex]?.kind;
    if (maybeTokenKind === undefined) {
        return false;
    }

    switch (maybeTokenKind) {
        case Token.TokenKind.Identifier:
        case Token.TokenKind.KeywordAnd:
        case Token.TokenKind.KeywordAs:
        case Token.TokenKind.KeywordEach:
        case Token.TokenKind.KeywordElse:
        case Token.TokenKind.KeywordError:
        case Token.TokenKind.KeywordFalse:
        case Token.TokenKind.KeywordHashBinary:
        case Token.TokenKind.KeywordHashDate:
        case Token.TokenKind.KeywordHashDateTime:
        case Token.TokenKind.KeywordHashDateTimeZone:
        case Token.TokenKind.KeywordHashDuration:
        case Token.TokenKind.KeywordHashInfinity:
        case Token.TokenKind.KeywordHashNan:
        case Token.TokenKind.KeywordHashSections:
        case Token.TokenKind.KeywordHashShared:
        case Token.TokenKind.KeywordHashTable:
        case Token.TokenKind.KeywordHashTime:
        case Token.TokenKind.KeywordIf:
        case Token.TokenKind.KeywordIn:
        case Token.TokenKind.KeywordIs:
        case Token.TokenKind.KeywordLet:
        case Token.TokenKind.KeywordMeta:
        case Token.TokenKind.KeywordNot:
        case Token.TokenKind.KeywordOr:
        case Token.TokenKind.KeywordOtherwise:
        case Token.TokenKind.KeywordSection:
        case Token.TokenKind.KeywordShared:
        case Token.TokenKind.KeywordThen:
        case Token.TokenKind.KeywordTrue:
        case Token.TokenKind.KeywordTry:
        case Token.TokenKind.KeywordType:
            return true;

        default:
            return false;
    }
}

// Assumes a call to readPrimaryExpression has already happened.
export function isRecursivePrimaryExpressionNext(
    state: IParserState,
    tokenIndexStart: number = state.tokenIndex,
): boolean {
    return (
        // section-access-expression
        // this.isOnTokenKind(TokenKind.Bang)
        // field-access-expression
        isTokenKind(state, Token.TokenKind.LeftBrace, tokenIndexStart) ||
        // item-access-expression
        isTokenKind(state, Token.TokenKind.LeftBracket, tokenIndexStart) ||
        // invoke-expression
        isTokenKind(state, Token.TokenKind.LeftParenthesis, tokenIndexStart)
    );
}

// -----------------------------
// ---------- Asserts ----------
// -----------------------------

export function assertGetContextNodeMetadata(state: IParserState): ContextNodeMetadata {
    Assert.isDefined(state.maybeCurrentContextNode);
    const currentContextNode: ParseContext.Node = state.maybeCurrentContextNode;

    Assert.isDefined(currentContextNode.maybeTokenStart);
    const tokenStart: Token.Token = currentContextNode.maybeTokenStart;

    // inclusive token index
    const tokenIndexEnd: number = state.tokenIndex - 1;
    const maybeTokenEnd: Token.Token | undefined = state.lexerSnapshot.tokens[tokenIndexEnd];
    Assert.isDefined(maybeTokenEnd);

    const tokenRange: Token.TokenRange = {
        tokenIndexStart: currentContextNode.tokenIndexStart,
        tokenIndexEnd,
        positionStart: tokenStart.positionStart,
        positionEnd: maybeTokenEnd.positionEnd,
    };

    const contextNode: ParseContext.Node = state.maybeCurrentContextNode;
    return {
        id: contextNode.id,
        maybeAttributeIndex: currentContextNode.maybeAttributeIndex,
        tokenRange,
    };
}

export function assertGetTokenAt(state: IParserState, tokenIndex: number): Token.Token {
    const lexerSnapshot: LexerSnapshot = state.lexerSnapshot;
    const maybeToken: Token.Token | undefined = lexerSnapshot.tokens[tokenIndex];
    Assert.isDefined(maybeToken, undefined, { tokenIndex });

    return maybeToken;
}

// -------------------------------
// ---------- Csv Tests ----------
// -------------------------------

// All of these tests assume you're in a given context and have just read a `,`.
// Eg. testCsvEndLetExpression assumes you're in a LetExpression context and have just read a `,`.

export function testCsvContinuationLetExpression(
    state: IParserState,
): ParseError.ExpectedCsvContinuationError | undefined {
    if (state.maybeCurrentTokenKind === Token.TokenKind.KeywordIn) {
        return new ParseError.ExpectedCsvContinuationError(
            state.localizationTemplates,
            ParseError.CsvContinuationKind.LetExpression,
            maybeCurrentTokenWithColumnNumber(state),
        );
    }

    return undefined;
}

export function testCsvContinuationDanglingComma(
    state: IParserState,
    tokenKind: Token.TokenKind,
): ParseError.ExpectedCsvContinuationError | undefined {
    if (state.maybeCurrentTokenKind === tokenKind) {
        return new ParseError.ExpectedCsvContinuationError(
            state.localizationTemplates,
            ParseError.CsvContinuationKind.DanglingComma,
            maybeCurrentTokenWithColumnNumber(state),
        );
    } else {
        return undefined;
    }
}

// -------------------------------------
// ---------- Asserts / Tests ----------
// -------------------------------------

export function testIsOnTokenKind(
    state: IParserState,
    expectedTokenKind: Token.TokenKind,
): ParseError.ExpectedTokenKindError | undefined {
    if (expectedTokenKind !== state.maybeCurrentTokenKind) {
        const maybeToken: ParseError.TokenWithColumnNumber | undefined = maybeCurrentTokenWithColumnNumber(state);
        return new ParseError.ExpectedTokenKindError(state.localizationTemplates, expectedTokenKind, maybeToken);
    } else {
        return undefined;
    }
}

export function testIsOnAnyTokenKind(
    state: IParserState,
    expectedAnyTokenKinds: ReadonlyArray<Token.TokenKind>,
): ParseError.ExpectedAnyTokenKindError | undefined {
    const isError: boolean =
        state.maybeCurrentTokenKind === undefined || expectedAnyTokenKinds.indexOf(state.maybeCurrentTokenKind) === -1;

    if (isError) {
        const maybeToken: ParseError.TokenWithColumnNumber | undefined = maybeCurrentTokenWithColumnNumber(state);
        return new ParseError.ExpectedAnyTokenKindError(state.localizationTemplates, expectedAnyTokenKinds, maybeToken);
    } else {
        return undefined;
    }
}

export function assertNoMoreTokens(state: IParserState): void {
    if (state.tokenIndex === state.lexerSnapshot.tokens.length) {
        return;
    }

    const token: Token.Token = assertGetTokenAt(state, state.tokenIndex);
    throw new ParseError.UnusedTokensRemainError(
        state.localizationTemplates,
        token,
        state.lexerSnapshot.graphemePositionStartFrom(token),
    );
}

export function assertNoOpenContext(state: IParserState): void {
    Assert.isUndefined(state.maybeCurrentContextNode, undefined, {
        contextNodeId: state.maybeCurrentContextNode?.id,
    });
}

// -------------------------------------
// ---------- Error factories ----------
// -------------------------------------

export function unterminatedParenthesesError(state: IParserState): ParseError.UnterminatedParenthesesError {
    const token: Token.Token = assertGetTokenAt(state, state.tokenIndex);
    return new ParseError.UnterminatedParenthesesError(
        state.localizationTemplates,
        token,
        state.lexerSnapshot.graphemePositionStartFrom(token),
    );
}

export function unterminatedBracketError(state: IParserState): ParseError.UnterminatedBracketError {
    const token: Token.Token = assertGetTokenAt(state, state.tokenIndex);
    return new ParseError.UnterminatedBracketError(
        state.localizationTemplates,
        token,
        state.lexerSnapshot.graphemePositionStartFrom(token),
    );
}

// ---------------------------------------------
// ---------- Column number factories ----------
// ---------------------------------------------

export function maybeCurrentTokenWithColumnNumber(state: IParserState): ParseError.TokenWithColumnNumber | undefined {
    return maybeTokenWithColumnNumber(state, state.tokenIndex);
}

export function maybeTokenWithColumnNumber(
    state: IParserState,
    tokenIndex: number,
): ParseError.TokenWithColumnNumber | undefined {
    const maybeToken: Token.Token | undefined = state.lexerSnapshot.tokens[tokenIndex];
    if (maybeToken === undefined) {
        return undefined;
    }
    const currentToken: Token.Token = maybeToken;

    return {
        token: currentToken,
        columnNumber: state.lexerSnapshot.columnNumberStartFrom(currentToken),
    };
}

interface ContextNodeMetadata {
    readonly id: number;
    readonly maybeAttributeIndex: number | undefined;
    readonly tokenRange: Token.TokenRange;
}
