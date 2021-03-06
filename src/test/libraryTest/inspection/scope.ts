// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { expect } from "chai";
import "mocha";
import { Inspection } from "../../..";
import { Assert } from "../../../common";
import { Position, ScopeItemByKey, ScopeItemKind } from "../../../inspection";
import { ActiveNode, ActiveNodeUtils } from "../../../inspection/activeNode";
import { Ast, Constant } from "../../../language";
import { IParserState, IParserStateUtils, NodeIdMap, ParseContext, ParseError, ParseOk } from "../../../parser";
import { CommonSettings, DefaultSettings, LexSettings, ParseSettings } from "../../../settings";
import { TestAssertUtils } from "../../testUtils";

export type TAbridgedNodeScopeItem =
    | AbridgedEachScopeItem
    | AbridgedKeyValuePairScopeItem
    | AbridgedParameterScopeItem
    | AbridgedSectionMemberScopeItem
    | AbridgedUndefinedScopeItem;

type AbridgedNodeScope = ReadonlyArray<TAbridgedNodeScopeItem>;

interface IAbridgedNodeScopeItem {
    readonly identifier: string;
    readonly isRecursive: boolean;
    readonly kind: ScopeItemKind;
}

interface AbridgedEachScopeItem extends IAbridgedNodeScopeItem {
    readonly kind: ScopeItemKind.Each;
    readonly eachExpressionNodeId: number;
}

interface AbridgedKeyValuePairScopeItem extends IAbridgedNodeScopeItem {
    readonly kind: ScopeItemKind.KeyValuePair;
    readonly keyNodeId: number;
    readonly maybeValueNodeId: number | undefined;
}

interface AbridgedParameterScopeItem extends IAbridgedNodeScopeItem {
    readonly kind: ScopeItemKind.Parameter;
    readonly nameNodeId: number;
    readonly isNullable: boolean;
    readonly isOptional: boolean;
    readonly maybeType: Constant.PrimitiveTypeConstantKind | undefined;
}

interface AbridgedSectionMemberScopeItem extends IAbridgedNodeScopeItem {
    readonly kind: ScopeItemKind.SectionMember;
    readonly keyNodeId: number;
}

interface AbridgedUndefinedScopeItem extends IAbridgedNodeScopeItem {
    readonly kind: ScopeItemKind.Undefined;
    readonly nodeId: number;
}

function abridgedScopeItemFactory(identifier: string, scopeItem: Inspection.TScopeItem): TAbridgedNodeScopeItem {
    switch (scopeItem.kind) {
        case ScopeItemKind.Each:
            return {
                identifier,
                isRecursive: scopeItem.isRecursive,
                kind: scopeItem.kind,
                eachExpressionNodeId: scopeItem.eachExpression.node.id,
            };

        case ScopeItemKind.KeyValuePair:
            return {
                identifier,
                isRecursive: scopeItem.isRecursive,
                kind: scopeItem.kind,
                keyNodeId: scopeItem.key.id,
                maybeValueNodeId: scopeItem.maybeValue?.node.id,
            };

        case ScopeItemKind.Parameter:
            return {
                identifier,
                isRecursive: scopeItem.isRecursive,
                kind: scopeItem.kind,
                nameNodeId: scopeItem.name.id,
                isNullable: scopeItem.isNullable,
                isOptional: scopeItem.isOptional,
                maybeType: scopeItem.maybeType,
            };

        case ScopeItemKind.SectionMember:
            return {
                identifier,
                isRecursive: scopeItem.isRecursive,
                kind: scopeItem.kind,
                keyNodeId: scopeItem.key.id,
            };

        case ScopeItemKind.Undefined:
            return {
                identifier,
                isRecursive: scopeItem.isRecursive,
                kind: scopeItem.kind,
                nodeId: scopeItem.xorNode.node.id,
            };

        default:
            throw Assert.isNever(scopeItem);
    }
}

function abridgedScopeItemsFactory(scopeItemByKey: ScopeItemByKey): ReadonlyArray<TAbridgedNodeScopeItem> {
    const result: TAbridgedNodeScopeItem[] = [];

    for (const [identifier, scopeItem] of scopeItemByKey.entries()) {
        result.push(abridgedScopeItemFactory(identifier, scopeItem));
    }

    return result;
}

function abridgedParametersFactory(scopeItemByKey: ScopeItemByKey): ReadonlyArray<AbridgedParameterScopeItem> {
    const result: AbridgedParameterScopeItem[] = [];

    for (const [identifier, scopeItem] of scopeItemByKey.entries()) {
        const abridged: TAbridgedNodeScopeItem = abridgedScopeItemFactory(identifier, scopeItem);
        if (abridged.kind === ScopeItemKind.Parameter) {
            result.push(abridged);
        }
    }

    return result;
}

function assertScopeForNodeOk(
    settings: CommonSettings,
    nodeIdMapCollection: NodeIdMap.Collection,
    leafNodeIds: ReadonlyArray<number>,
    position: Position,
): ScopeItemByKey {
    const maybeActiveNode: ActiveNode | undefined = ActiveNodeUtils.maybeActiveNode(
        nodeIdMapCollection,
        leafNodeIds,
        position,
    );
    if (maybeActiveNode === undefined) {
        return new Map();
    }
    const activeNode: ActiveNode = maybeActiveNode;

    const triedScopeInspection: Inspection.TriedScopeForRoot = Inspection.tryScopeItems(
        settings,
        nodeIdMapCollection,
        leafNodeIds,
        activeNode.ancestry[0].node.id,
        undefined,
    );
    Assert.isOk(triedScopeInspection);
    return triedScopeInspection.value;
}

export function assertGetParseOkScopeOk(
    settings: LexSettings & ParseSettings<IParserState>,
    text: string,
    position: Position,
): ScopeItemByKey {
    const parseOk: ParseOk = TestAssertUtils.assertGetParseOk(settings, text, IParserStateUtils.stateFactory);
    const contextState: ParseContext.State = parseOk.state.contextState;
    return assertScopeForNodeOk(settings, contextState.nodeIdMapCollection, contextState.leafNodeIds, position);
}

export function assertGetParseErrScopeOk(
    settings: LexSettings & ParseSettings<IParserState>,
    text: string,
    position: Position,
): ScopeItemByKey {
    const parseError: ParseError.ParseError = TestAssertUtils.assertGetParseErr(
        settings,
        text,
        IParserStateUtils.stateFactory,
    );
    const contextState: ParseContext.State = parseError.state.contextState;
    return assertScopeForNodeOk(settings, contextState.nodeIdMapCollection, contextState.leafNodeIds, position);
}

describe(`subset Inspection - Scope - Identifier`, () => {
    describe(`Scope`, () => {
        describe(`${Ast.NodeKind.EachExpression} (Ast)`, () => {
            it(`|each 1`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `|each 1`,
                );
                const expected: ReadonlyArray<TAbridgedNodeScopeItem> = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`each| 1`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `each| 1`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`each |1`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `each |1`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "_",
                        isRecursive: false,
                        kind: ScopeItemKind.Each,
                        eachExpressionNodeId: 1,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`each 1|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `each 1|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "_",
                        isRecursive: false,
                        kind: ScopeItemKind.Each,
                        eachExpressionNodeId: 1,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`each each 1|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `each each 1|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "_",
                        isRecursive: false,
                        kind: ScopeItemKind.Each,
                        eachExpressionNodeId: 3,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.EachExpression} (ParserContext)`, () => {
            it(`each|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `each|`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`each |`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `each |`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "_",
                        isRecursive: false,
                        kind: ScopeItemKind.Each,
                        eachExpressionNodeId: 1,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.FunctionExpression} (Ast)`, () => {
            it(`|(x) => z`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `|(x) => z`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`(x|, y) => z`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `(x|, y) => z`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`(x, y)| => z`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `(x, y)| => z`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`(x, y) => z|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `(x, y) => z|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.Parameter,
                        isRecursive: false,
                        nameNodeId: 7,
                        isNullable: true,
                        isOptional: false,
                        maybeType: undefined,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.Parameter,
                        isRecursive: false,
                        nameNodeId: 11,
                        isNullable: true,
                        isOptional: false,
                        maybeType: undefined,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.FunctionExpression} (ParserContext)`, () => {
            it(`|(x) =>`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `|(x) =>`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`(x|, y) =>`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `(x|, y) =>`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`(x, y)| =>`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `(x, y)| =>`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`(x, y) =>|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `(x, y) =>|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.Parameter,
                        isRecursive: false,
                        nameNodeId: 7,
                        isNullable: true,
                        isOptional: false,
                        maybeType: undefined,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.Parameter,
                        isRecursive: false,
                        nameNodeId: 11,
                        isNullable: true,
                        isOptional: false,
                        maybeType: undefined,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.IdentifierExpression} (Ast)`, () => {
            it(`let x = 1, y = x in 1|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let x = 1, y = x in 1|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 14,
                        maybeValueNodeId: 18,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.RecordExpression} (Ast)`, () => {
            it(`|[a=1]`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `|[a=1]`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[|a=1]`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[|a=1]`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=1|]`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=1|]`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 8,
                        maybeValueNodeId: 12,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=1, b=2|]`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=1, b=2|]`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 8,
                        maybeValueNodeId: 12,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 16,
                        maybeValueNodeId: 20,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=1, b=2|, c=3]`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=1, b=2|, c=3]`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 8,
                        maybeValueNodeId: 12,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 16,
                        maybeValueNodeId: 20,
                    },
                    {
                        identifier: "c",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 24,
                        maybeValueNodeId: 28,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=1]|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=1]|`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=[|b=1]]`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=[|b=1]]`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 8,
                        maybeValueNodeId: 12,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.RecordExpression} (ParserContext)`, () => {
            it(`|[a=1`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `|[a=1`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[|a=1`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[|a=1`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=|1`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=|1`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 7,
                        maybeValueNodeId: 9,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=1|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=1|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 7,
                        maybeValueNodeId: 9,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=1, b=|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=1, b=|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 7,
                        maybeValueNodeId: 9,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 13,
                        maybeValueNodeId: 15,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=1, b=2|, c=3`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=1, b=2|, c=3`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 7,
                        maybeValueNodeId: 9,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 13,
                        maybeValueNodeId: 15,
                    },
                    {
                        identifier: "c",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 19,
                        maybeValueNodeId: 21,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=[|b=1`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=[|b=1`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 7,
                        maybeValueNodeId: 9,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`[a=[b=|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `[a=[b=|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 7,
                        maybeValueNodeId: 9,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 14,
                        maybeValueNodeId: 16,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.Section} (Ast)`, () => {
            it(`s|ection foo; x = 1; y = 2;`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `s|ection foo; x = 1; y = 2;`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`section foo; x = 1|; y = 2;`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `section foo; x = 1|; y = 2;`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: true,
                        keyNodeId: 8,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: false,
                        keyNodeId: 16,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`section foo; x = 1; y = 2|;`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `section foo; x = 1; y = 2|;`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: false,
                        keyNodeId: 8,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: true,
                        keyNodeId: 16,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`section foo; x = 1; y = 2;|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `section foo; x = 1; y = 2;|`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`section foo; x = 1; y = 2; z = let a = 1 in |b;`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `section foo; x = 1; y = 2; z = let a = 1 in |b;`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: false,
                        keyNodeId: 8,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: false,
                        keyNodeId: 16,
                    },
                    {
                        identifier: "z",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: true,
                        keyNodeId: 24,
                    },
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 31,
                        maybeValueNodeId: 35,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.SectionMember} (ParserContext)`, () => {
            it(`s|ection foo; x = 1; y = 2`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `s|ection foo; x = 1; y = 2`,
                );
                const expected: AbridgedNodeScope = [];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`section foo; x = 1|; y = 2`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `section foo; x = 1|; y = 2`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: true,
                        keyNodeId: 8,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: false,
                        keyNodeId: 16,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`section foo; x = 1; y = 2|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `section foo; x = 1; y = 2|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: false,
                        keyNodeId: 8,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: true,
                        keyNodeId: 16,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`section foo; x = 1; y = () => 10|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `section foo; x = 1; y = () => 10|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: false,
                        keyNodeId: 8,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.SectionMember,
                        isRecursive: true,
                        keyNodeId: 16,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.LetExpression} (Ast)`, () => {
            it(`let a = 1 in |x`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let a = 1 in |x`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let a = 1 in x|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let a = 1 in x|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let a = |1 in x`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let a = |1 in x`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let a = 1, b = 2 in x|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let a = 1, b = 2 in x|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 14,
                        maybeValueNodeId: 18,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let a = 1|, b = 2 in x`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let a = 1|, b = 2 in x`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 14,
                        maybeValueNodeId: 18,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`(p1, p2) => let a = 1, b = 2, c = 3| in c`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `(p1, p2) => let a = 1, b = 2, c = 3| in c`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "p1",
                        kind: ScopeItemKind.Parameter,
                        isRecursive: false,
                        nameNodeId: 7,
                        isNullable: true,
                        isOptional: false,
                        maybeType: undefined,
                    },
                    {
                        identifier: "p2",
                        kind: ScopeItemKind.Parameter,
                        isRecursive: false,
                        nameNodeId: 11,
                        isNullable: true,
                        isOptional: false,
                        maybeType: undefined,
                    },
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 19,
                        maybeValueNodeId: 23,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 27,
                        maybeValueNodeId: 31,
                    },
                    {
                        identifier: "c",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 35,
                        maybeValueNodeId: 39,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let eggs = let ham = 0 in 1, foo = 2, bar = 3 in 4|`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let eggs = let ham = 0 in 1, foo = 2, bar = 3 in 4|`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "eggs",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 6,
                        maybeValueNodeId: 8,
                    },
                    {
                        identifier: "foo",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 25,
                        maybeValueNodeId: 29,
                    },
                    {
                        identifier: "bar",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 33,
                        maybeValueNodeId: 37,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let eggs = let ham = 0 in |1, foo = 2, bar = 3 in 4`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let eggs = let ham = 0 in |1, foo = 2, bar = 3 in 4`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "eggs",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 6,
                        maybeValueNodeId: 8,
                    },
                    {
                        identifier: "foo",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 25,
                        maybeValueNodeId: 29,
                    },
                    {
                        identifier: "bar",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 33,
                        maybeValueNodeId: 37,
                    },
                    {
                        identifier: "ham",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 13,
                        maybeValueNodeId: 17,
                    },
                ];
                const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedScopeItemsFactory(
                    assertGetParseOkScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });

        describe(`${Ast.NodeKind.LetExpression} (ParserContext)`, () => {
            it(`let a = 1 in |`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let a = 1 in |`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let a = 1, b = 2 in |`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let a = 1, b = 2 in |`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 14,
                        maybeValueNodeId: 18,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let a = 1|, b = 2 in`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let a = 1|, b = 2 in `,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "a",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                    {
                        identifier: "b",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 14,
                        maybeValueNodeId: 18,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let x = (let y = 1 in z|) in`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let x = (let y = 1 in z|) in`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: true,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                    {
                        identifier: "y",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 17,
                        maybeValueNodeId: 21,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });

            it(`let x = (let y = 1 in z) in |`, () => {
                const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                    `let x = (let y = 1 in z) in |`,
                );
                const expected: AbridgedNodeScope = [
                    {
                        identifier: "x",
                        kind: ScopeItemKind.KeyValuePair,
                        isRecursive: false,
                        keyNodeId: 6,
                        maybeValueNodeId: 10,
                    },
                ];
                const actual: AbridgedNodeScope = abridgedScopeItemsFactory(
                    assertGetParseErrScopeOk(DefaultSettings, text, position),
                );
                expect(actual).to.deep.equal(expected);
            });
        });
    });

    describe(`Parameter`, () => {
        it(`(a, b as number, c as nullable function, optional d, optional e as table) => 1|`, () => {
            const [text, position]: [string, Inspection.Position] = TestAssertUtils.assertGetTextWithPosition(
                `(a, b as number, c as nullable function, optional d, optional e as table) => 1|`,
            );
            const expected: ReadonlyArray<AbridgedParameterScopeItem> = [
                {
                    identifier: "a",
                    kind: ScopeItemKind.Parameter,
                    isRecursive: false,
                    nameNodeId: 7,
                    isNullable: true,
                    isOptional: false,
                    maybeType: undefined,
                },
                {
                    identifier: "b",
                    kind: ScopeItemKind.Parameter,
                    isRecursive: false,
                    nameNodeId: 11,
                    isNullable: false,
                    isOptional: false,
                    maybeType: Constant.PrimitiveTypeConstantKind.Number,
                },
                {
                    identifier: "c",
                    kind: ScopeItemKind.Parameter,
                    isRecursive: false,
                    nameNodeId: 18,
                    isNullable: true,
                    isOptional: false,
                    maybeType: Constant.PrimitiveTypeConstantKind.Function,
                },
                {
                    identifier: "d",
                    kind: ScopeItemKind.Parameter,
                    isRecursive: false,
                    nameNodeId: 28,
                    isNullable: true,
                    isOptional: true,
                    maybeType: undefined,
                },
                {
                    identifier: "e",
                    kind: ScopeItemKind.Parameter,
                    isRecursive: false,
                    nameNodeId: 33,
                    isNullable: false,
                    isOptional: true,
                    maybeType: Constant.PrimitiveTypeConstantKind.Table,
                },
            ];
            const actual: ReadonlyArray<TAbridgedNodeScopeItem> = abridgedParametersFactory(
                assertGetParseOkScopeOk(DefaultSettings, text, position),
            );
            expect(actual).to.deep.equal(expected);
        });
    });
});
