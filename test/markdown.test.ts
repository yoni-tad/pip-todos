import test from "node:test";
import assert from "node:assert/strict";
import { parse, serialize } from "../src/markdown";

test("parse reads the name from the first heading", () => {
  const list = parse("# bego\n\n- [ ] one\n");
  assert.equal(list.name, "bego");
});

test("parse reads open and done items in file order", () => {
  const list = parse("# x\n\n- [ ] one\n- [x] two\n- [X] three\n");
  assert.deepEqual(list.items, [
    { text: "one", done: false },
    { text: "two", done: true },
    { text: "three", done: true },
  ]);
});

test("parse ignores unrelated lines without crashing", () => {
  const list = parse("# x\nsome prose\n> a quote\n- [ ] keep me\n## sub\n");
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].text, "keep me");
});

test("parse tolerates empty or non-string input", () => {
  assert.deepEqual(parse(""), { name: "", items: [] });
  // @ts-expect-error testing a bad caller
  assert.deepEqual(parse(undefined), { name: "", items: [] });
});

test("parse accepts asterisk bullets", () => {
  const list = parse("# x\n* [ ] star\n");
  assert.equal(list.items[0].text, "star");
});

test("serialize produces round-trippable markdown", () => {
  const original = {
    name: "ideas",
    items: [
      { text: "ship it", done: false },
      { text: "write tests", done: true },
    ],
  };
  const text = serialize(original);
  assert.equal(text, "# ideas\n\n- [ ] ship it\n- [x] write tests\n");
  assert.deepEqual(parse(text), original);
});

test("serialize of an empty list keeps the heading", () => {
  const text = serialize({ name: "inbox", items: [] });
  assert.equal(text, "# inbox\n\n");
  assert.deepEqual(parse(text), { name: "inbox", items: [] });
});
