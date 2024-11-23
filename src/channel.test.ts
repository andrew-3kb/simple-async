import { expect, test, describe } from "vitest";
import { delay } from "./delay";
import {
  addTaskToChannel,
  addTaskToChannelExclusively,
  createChannel,
  type ChannelEvent,
  type ChannelTaskEvent,
} from "./channel";

describe("Channel", () => {
  test("executes syncronous tasks in order", async () => {
    const channel = createChannel({ concurrency: 1 });
    const output: number[] = [];
    await Promise.all([
      addTaskToChannel({ channel, task: () => output.push(1) }),
      addTaskToChannel({ channel, task: () => output.push(2) }),
      addTaskToChannel({ channel, task: () => output.push(3) }),
    ]);
    expect(output).toEqual([1, 2, 3]);
  });

  test("executes async tasks in order", async () => {
    const channel = createChannel({ concurrency: 1 });
    const output: number[] = [];
    await Promise.all([
      addTaskToChannel({
        channel,
        task: async () => {
          output.push(11);
          await delay(10);
          output.push(12);
        },
      }),
      addTaskToChannel({
        channel,
        task: async () => {
          output.push(21);
          await delay(10);
          output.push(22);
        },
      }),
      addTaskToChannel({
        channel,
        task: async () => {
          output.push(31);
          await delay(10);
          output.push(32);
        },
      }),
    ]);
    expect(output).toEqual([11, 21, 12, 22, 31, 32]);
  });

  test("concurrently executes tasks if passed concurrency", async () => {
    const channel = createChannel({ concurrency: 2 });
    const output: number[] = [];
    await Promise.all([
      addTaskToChannel({
        channel,
        task: async () => {
          output.push(11);
          await delay(10);
          output.push(12);
        },
      }),
      addTaskToChannel({
        channel,
        task: async () => {
          output.push(21);
          await delay(10);
          output.push(22);
        },
      }),
      addTaskToChannel({
        channel,
        task: async () => {
          output.push(31);
          await delay(10);
          output.push(32);
        },
      }),
    ]);
    expect(output).toEqual([11, 21, 12, 22, 31, 32]);
  });

  test("addTaskToChannelExclusively() cancels any existing tasks in the queue", async () => {
    const channel = createChannel({ concurrency: 1 });
    const output: number[] = [];
    const results = await Promise.all([
      addTaskToChannelExclusively({
        channel,
        task: async () => {
          output.push(11);
          await delay(10);
          output.push(12);
          return 1;
        },
      }),
      addTaskToChannelExclusively({
        channel,
        task: async () => {
          output.push(21);
          await delay(10);
          output.push(22);
          return 2;
        },
      }),
      addTaskToChannelExclusively({
        channel,
        task: async () => {
          output.push(31);
          await delay(10);
          output.push(32);
          return 3;
        },
      }),
    ]);
    expect(output).toEqual([11, 12, 31, 32]);
    expect(results).toEqual([
      expect.objectContaining({ isSuccess: true, result: 1 }),
      expect.objectContaining({ isCancelation: true }),
      expect.objectContaining({ isSuccess: true, result: 3 }),
    ]);
  });

  test("catches errors in task and returns them in result", async () => {
    const channel = createChannel({ concurrency: 1 });
    const result = await addTaskToChannel({
      channel,
      task: async () => {
        throw new Error("Error 1");
      },
    });
    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(result.error).toEqual(
      expect.objectContaining({ message: "Error 1" }),
    );
  });

  test("calls event handlers correctly", async () => {
    const events: ChannelEvent[] = [];
    const taskEvents: ChannelTaskEvent[] = [];
    const channel = createChannel({
      concurrency: 1,
      eventHandler: (event) => events.push(event),
    });
    await Promise.all([
      addTaskToChannelExclusively({
        channel,
        task: async () => {
          await delay(10);
          return 1;
        },
      }),
      addTaskToChannelExclusively({
        channel,
        eventHandler: (event) => taskEvents.push(event),
        task: async () => {
          await delay(10);
          return 2;
        },
      }),
      addTaskToChannelExclusively({
        channel,
        task: async () => {
          await delay(10);
          return 3;
        },
      }),
    ]);
    expect(events).toEqual([
      expect.objectContaining({ type: "TASK_ADDED" }),
      expect.objectContaining({ type: "TASK_STARTED" }),
      expect.objectContaining({ type: "TASK_ADDED" }),
      expect.objectContaining({ type: "CANCELLED_ALL_TASKS" }),
      expect.objectContaining({ type: "TASK_CANCELLED" }),
      expect.objectContaining({ type: "TASK_ADDED" }),
      expect.objectContaining({ type: "TASK_COMPLETED" }),
      expect.objectContaining({ type: "TASK_STARTED" }),
      expect.objectContaining({ type: "TASK_COMPLETED" }),
    ]);
    expect(taskEvents).toEqual([
      expect.objectContaining({ type: "TASK_ADDED" }),
      expect.objectContaining({ type: "TASK_CANCELLED" }),
    ]);
  });
});
