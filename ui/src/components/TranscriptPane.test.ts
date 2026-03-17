import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TranscriptPane from "./TranscriptPane.vue";
import type { TranscriptTurn } from "../lib/transcript";

const transcript: TranscriptTurn[] = [
  {
    id: "turn_1",
    status: "completed",
    error: null,
    items: [{ id: "item_1", kind: "assistant", text: "Hello", status: "done" }],
  },
];

describe("TranscriptPane", () => {
  it("renders transcript items and emits send", async () => {
    const wrapper = mount(TranscriptPane, {
      props: {
        threadName: "Greeting",
        transcript,
        busy: false,
        connected: true,
      },
    });

    expect(wrapper.text()).toContain("Hello");
    await wrapper.find("textarea").setValue("Ship it");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("send")).toEqual([["Ship it"]]);
  });
});
