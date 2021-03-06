// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Ast, Constant } from "../../language";
import { AncestryUtils, TXorNode, XorNodeKind } from "../../parser";
import { ActiveNode } from "../activeNode";
import { PositionUtils } from "../position";
import { TrailingToken } from "./commonTypes";

export function autocompletePrimitiveType(
    activeNode: ActiveNode,
    maybeTrailingToken: TrailingToken | undefined,
): ReadonlyArray<Constant.PrimitiveTypeConstantKind> {
    return filterRecommendations(traverseAncestors(activeNode), maybeTrailingToken);
}

function filterRecommendations(
    inspected: ReadonlyArray<Constant.PrimitiveTypeConstantKind>,
    maybeTrailingToken: TrailingToken | undefined,
): ReadonlyArray<Constant.PrimitiveTypeConstantKind> {
    if (maybeTrailingToken === undefined) {
        return inspected;
    }
    const trailingData: string = maybeTrailingToken.data;

    return inspected.filter((primitiveTypeConstantKind: Constant.PrimitiveTypeConstantKind) =>
        primitiveTypeConstantKind.startsWith(trailingData),
    );
}

function traverseAncestors(activeNode: ActiveNode): ReadonlyArray<Constant.PrimitiveTypeConstantKind> {
    if (activeNode.ancestry.length === 0) {
        return [];
    }

    const ancestry: ReadonlyArray<TXorNode> = activeNode.ancestry;

    const numAncestors: number = activeNode.ancestry.length;
    for (let index: number = 0; index < numAncestors; index += 1) {
        const parent: TXorNode = ancestry[index];
        const maybeChild: TXorNode | undefined = ancestry[index - 1];
        // If on the second attribute for TypePrimaryType.
        // `type |`
        if (parent.node.kind === Ast.NodeKind.TypePrimaryType) {
            if (maybeChild === undefined) {
                return Constant.PrimitiveTypeConstantKinds;
            } else if (
                maybeChild.node.maybeAttributeIndex === 0 &&
                maybeChild.kind === XorNodeKind.Ast &&
                PositionUtils.isAfterAst(activeNode.position, maybeChild.node as Ast.TNode, true)
            ) {
                return Constant.PrimitiveTypeConstantKinds;
            }
        }
        // If on a FunctionExpression parameter.
        else if (
            parent.node.kind === Ast.NodeKind.Parameter &&
            AncestryUtils.maybeNthNextXor(ancestry, index, 4, [Ast.NodeKind.FunctionExpression]) !== undefined
        ) {
            // Things get messy when testing if it's on a nullable primitive type OR a primitive type.
            const maybeGrandchild: TXorNode | undefined = AncestryUtils.maybeNthPreviousXor(
                ancestry,
                index,
                2,
                undefined,
            );
            if (maybeGrandchild === undefined) {
                continue;
            }
            // On primitive type.
            // `(x as |) => 0`
            else if (
                maybeGrandchild.kind === XorNodeKind.Ast &&
                maybeGrandchild.node.kind === Ast.NodeKind.Constant &&
                maybeGrandchild.node.constantKind === Constant.KeywordConstantKind.As &&
                PositionUtils.isAfterAst(activeNode.position, maybeGrandchild.node, true)
            ) {
                return Constant.PrimitiveTypeConstantKinds;
            }
            // On nullable primitive type
            // `(x as nullable |) => 0`
            else if (maybeGrandchild.node.kind === Ast.NodeKind.NullablePrimitiveType) {
                const maybeGreatGreatGrandchild: TXorNode | undefined = AncestryUtils.maybeNthPreviousXor(
                    ancestry,
                    index,
                    3,
                    undefined,
                );
                if (maybeGreatGreatGrandchild?.node.kind === Ast.NodeKind.PrimitiveType) {
                    return Constant.PrimitiveTypeConstantKinds;
                }
            }
        }
    }

    return [];
}
