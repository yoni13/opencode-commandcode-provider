import { expect, test } from "bun:test"
import { findStringAssignment } from "../../scripts/sync-models.ts"

test("resolves string assignments for dollar-prefixed minified identifiers", () => {
  expect(findStringAssignment('var $I="baseten";', "$I")).toBe("baseten")
})

test("resolves aliases to dollar-prefixed minified identifiers", () => {
  expect(findStringAssignment('var provider=$I,$I="baseten";', "provider")).toBe("baseten")
})
