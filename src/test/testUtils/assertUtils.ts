// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { expect } from "chai";
import "mocha";
import { Assert, Inspection, Lexer, Task } from "../..";
import { AutocompleteOption, Position, TriedAutocomplete } from "../../inspection";
import { ActiveNode, ActiveNodeUtils } from "../../inspection/activeNode";
import { Keyword } from "../../language";
import { IParserState, IParserUtils, ParseError, ParseOk, TriedParse } from "../../parser";
import { CommonSettings, LexSettings, ParseSettings } from "../../settings";

// Only works with single line expressions
export function assertGetTextWithPosition(text: string): [string, Inspection.Position] {
    const indexOfPipe: number = text.indexOf("|");

    expect(indexOfPipe).to.be.greaterThan(-1, "text must have | marker");
    expect(indexOfPipe).to.equal(text.lastIndexOf("|"), "text must have one and only one '|'");

    const position: Inspection.Position = {
        lineNumber: 0,
        lineCodeUnit: indexOfPipe,
    };

    return [text.replace("|", ""), position];
}

export function assertGetLexParseOk<S extends IParserState = IParserState>(
    settings: LexSettings & ParseSettings<S>,
    text: string,
): Task.LexParseOk<S> {
    const triedLexParse: Task.TriedLexParse<S> = Task.tryLexParse(settings, text);
    Assert.isOk(triedLexParse);
    return triedLexParse.value;
}

export function assertGetParseErr<S extends IParserState = IParserState>(
    settings: LexSettings & ParseSettings<S>,
    text: string,
): ParseError.ParseError<S> {
    const triedParse: TriedParse<S> = assertGetTriedParse(settings, text);
    Assert.isErr(triedParse);

    if (!ParseError.isParseError(triedParse.error)) {
        throw new Error(`expected triedParse to return a ParseError.ParseError: ${triedParse.error.message}`);
    }

    return triedParse.error;
}

export function assertGetParseOk<S extends IParserState = IParserState>(
    settings: LexSettings & ParseSettings<S>,
    text: string,
): ParseOk<S> {
    const triedParse: TriedParse<S> = assertGetTriedParse(settings, text);
    Assert.isOk(triedParse);
    return triedParse.value;
}

// I only care about errors coming from the parse stage.
// If I use tryLexParse I might get a CommonError which could have come either from lexing or parsing.
function assertGetTriedParse<S extends IParserState = IParserState>(
    settings: LexSettings & ParseSettings<S>,
    text: string,
): TriedParse<S> {
    const triedLex: Lexer.TriedLex = Lexer.tryLex(settings, text);
    Assert.isOk(triedLex);
    const lexerState: Lexer.State = triedLex.value;
    Assert.isUndefined(Lexer.maybeErrorLineMap(lexerState));

    const triedSnapshot: Lexer.TriedLexerSnapshot = Lexer.trySnapshot(lexerState);
    Assert.isOk(triedSnapshot);
    const lexerSnapshot: Lexer.LexerSnapshot = triedSnapshot.value;

    return IParserUtils.tryParse<S>(settings, lexerSnapshot);
}

export function assertGetParseOkAutocompleteOk(
    settings: LexSettings & ParseSettings<IParserState>,
    text: string,
    position: Position,
): ReadonlyArray<AutocompleteOption> {
    const parseOk: ParseOk = assertGetParseOk(settings, text);
    return assertGetAutocompleteOk(settings, parseOk.state, position, undefined);
}

export function assertGetParseErrAutocompleteOk(
    settings: LexSettings & ParseSettings<IParserState>,
    text: string,
    position: Position,
): ReadonlyArray<AutocompleteOption> {
    const parseError: ParseError.ParseError = assertGetParseErr(settings, text);

    return assertGetAutocompleteOk(settings, parseError.state, position, parseError);
}

export function assertGetAutocompleteOk<S extends IParserState>(
    settings: CommonSettings,
    parserState: IParserState,
    position: Position,
    maybeParseError: ParseError.ParseError<S> | undefined,
): ReadonlyArray<AutocompleteOption> {
    const maybeActiveNode: ActiveNode | undefined = ActiveNodeUtils.maybeActiveNode(
        parserState.contextState.nodeIdMapCollection,
        parserState.contextState.leafNodeIds,
        position,
    );
    if (maybeActiveNode === undefined) {
        return Keyword.StartOfDocumentKeywords;
    }

    const triedInspect: TriedAutocomplete = Inspection.tryAutocomplete(
        settings,
        parserState,
        {
            scopeById: new Map(),
            typeById: new Map(),
        },
        maybeActiveNode,
        maybeParseError,
    );
    Assert.isOk(triedInspect);
    return triedInspect.value;
}
