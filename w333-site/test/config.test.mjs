import { test } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder } from "ethers";
import { SECURITY, ULN, ulnBytes, assertUln } from "../src/security.js";
import { matchesRuntime } from "../src/validation.js";
test("security plan requires two matching organisations on both sides with matched confirmation depths", () => {
  for (const k of ["xlayer", "bnb"])
    for (const receive of [false, true]) {
      const [raw] = AbiCoder.defaultAbiCoder().decode(
        [ULN],
        ulnBytes(k, receive),
      );
      assert.equal(raw.optionalDVNCount, 255n); // explicit NIL; never inherit optional DVNs
      const effective = AbiCoder.defaultAbiCoder().encode(
        [ULN],
        [[raw.confirmations, 2, 0, 0, raw.requiredDVNs, []]],
      );
      assertUln(k, effective, receive);
      const dead = AbiCoder.defaultAbiCoder().encode(
        [ULN],
        [
          [
            raw.confirmations,
            1,
            0,
            0,
            ["0x000000000000000000000000000000000000dead"],
            [],
          ],
        ],
      );
      assert.throws(() => assertUln(k, dead, receive));
    }
  assert.equal(SECURITY.xlayer.confirmations, 225000);
  assert.equal(SECURITY.bnb.confirmations, 20);
});
test("runtime validation only ignores declared immutable slots; altered executable code rejected", () => {
  const artifact = {
    deployedBytecode: "0x6000006055",
    immutableReferences: { a: [{ start: 1, length: 2 }] },
  };
  assert.equal(matchesRuntime("0x60abcd6055", artifact), true);
  assert.equal(matchesRuntime("0x61abcd6055", artifact), false);
  assert.equal(matchesRuntime("0x60abcd605500", artifact), false);
});
