import { runNextTick } from "./delay";
import { isPromise, createPendingPromise } from "./promise";

export type ChannelTaskEvent =
  | {
      type: "TASK_CANCELLED";
      channel: Channel;
      task: ChannelTask;
    }
  | {
      type: "TASK_COMPLETED";
      channel: Channel;
      task: ChannelTask;
      isSuccess: boolean;
      isError: boolean;
      result: unknown;
    }
  | {
      type: "TASK_STARTED";
      channel: Channel;
      task: ChannelTask;
    }
  | {
      type: "TASK_ADDED";
      channel: Channel;
      task: ChannelTask;
    };

export type ChannelTask<T = unknown> = {
  task: () => T;
  priority: number;
  requestedAt: number;
  eventHandler?: (event: ChannelTaskEvent) => void;
};

export type ChannelEvent =
  | {
      type: "CANCELLED_ALL_TASKS";
      channel: Channel;
    }
  | ChannelTaskEvent;

export type Channel = {
  concurrency: number;
  eventHandler: (event: ChannelEvent) => void;
  tasksInProgress: ChannelTask[];
  tasksInQueue: ChannelTask[];
};

export type ChannelTaskResult<T> =
  | {
      isSuccess: true;
      isError: false;
      isCancelation: false;
      result: T;
      error: undefined;
    }
  | {
      isSuccess: false;
      isError: true;
      isCancelation: false;
      error: unknown;
      result: undefined;
    }
  | {
      isSuccess: false;
      isError: false;
      isCancelation: true;
      error: undefined;
      result: undefined;
    };

const sendEvent = (args: {
  task: ChannelTask;
  channel: Channel;
  event: ChannelTaskEvent;
}) => {
  args.channel.eventHandler(args.event);
  args.task.eventHandler?.(args.event);
};

export const createChannel = (args?: {
  concurrency?: number;
  eventHandler?: (event: ChannelEvent) => void;
}) => {
  return {
    concurrency: args?.concurrency || 1,
    eventHandler: args?.eventHandler || (() => {}),
    tasksInProgress: [],
    tasksInQueue: [],
  };
};

export const addTaskToChannel = <T>(options: {
  channel: Channel;
  task: () => T;
  priority?: number;
  eventHandler?: (event: ChannelTaskEvent) => void;
}): Promise<ChannelTaskResult<Awaited<T>>> => {
  const priority = options?.priority ?? 0;
  const requestedAt = Date.now();
  const resultPromise = createPendingPromise<ChannelTaskResult<Awaited<T>>>();

  const eventHandler = (event: ChannelTaskEvent) => {
    if (event.type === "TASK_COMPLETED") {
      if (event.isSuccess) {
        resultPromise.resolve({
          isSuccess: true,
          isError: false,
          isCancelation: false,
          result: event.result as Awaited<T>,
          error: undefined,
        });
      } else {
        resultPromise.resolve({
          isSuccess: false,
          isError: true,
          isCancelation: false,
          result: undefined,
          error: event.result,
        });
      }
    } else if (event.type === "TASK_CANCELLED") {
      resultPromise.resolve({
        isSuccess: false,
        isError: false,
        isCancelation: true,
        result: undefined,
        error: undefined,
      });
    }

    if (options.eventHandler) {
      options.eventHandler(event);
    }
  };

  const task: ChannelTask = {
    task: options.task,
    priority,
    requestedAt,
    eventHandler,
  };
  options.channel.tasksInQueue.push(task);
  options.channel.tasksInQueue.sort(sortChannelQueue);

  sendEvent({
    task,
    channel: options.channel,
    event: {
      type: "TASK_ADDED",
      channel: options.channel,
      task,
    },
  });

  proccessChannel(options.channel);
  return resultPromise.promise;
};

const sortChannelQueue = (a: ChannelTask, b: ChannelTask) => {
  if (a.priority === b.priority) {
    return a.requestedAt - b.requestedAt;
  }
  return a.priority - b.priority;
};
export const cancelAllChannelTasks = (channel: Channel) => {
  const tasks = channel.tasksInQueue;
  channel.tasksInQueue = [];
  channel.eventHandler({
    type: "CANCELLED_ALL_TASKS",
    channel,
  });
  for (const task of tasks) {
    sendEvent({
      task,
      channel: channel,
      event: {
        type: "TASK_CANCELLED",
        channel,
        task,
      },
    });
  }
};

export const cancelChannelTask = (options: {
  task: () => unknown;
  channel: Channel;
}) => {
  const foundChannelIndex = options.channel.tasksInQueue.findIndex(
    (x) => x.task === options.task,
  );
  if (foundChannelIndex === -1) {
    return;
  }
  const [taskInfo] = options.channel.tasksInQueue.splice(foundChannelIndex, 1);
  if (!taskInfo) {
    return;
  }
  sendEvent({
    task: taskInfo,
    channel: options.channel,
    event: {
      type: "TASK_CANCELLED",
      channel: options.channel,
      task: taskInfo,
    },
  });
};

const proccessChannel = (channel: Channel) => {
  if (channel.tasksInProgress.length >= channel.concurrency) {
    return;
  }

  const task = channel.tasksInQueue.shift();
  if (!task) {
    return;
  }
  channel.tasksInProgress.push(task);
  const removeTaskFromInProgress = () => {
    channel.tasksInProgress.splice(channel.tasksInProgress.indexOf(task), 1);
  };

  sendEvent({
    task: task,
    channel: channel,
    event: {
      type: "TASK_STARTED",
      channel,
      task,
    },
  });

  let result: unknown;
  try {
    result = task.task();
  } catch (e) {
    removeTaskFromInProgress();
    sendEvent({
      task: task,
      channel: channel,
      event: {
        type: "TASK_COMPLETED",
        channel,
        task,
        isSuccess: false,
        isError: true,
        result: e,
      },
    });
    runNextTick(() => {
      proccessChannel(channel);
    });
    return;
  }

  if (isPromise(result)) {
    result
      .then((value) => {
        removeTaskFromInProgress();
        sendEvent({
          task: task,
          channel: channel,
          event: {
            type: "TASK_COMPLETED",
            channel,
            task,
            isSuccess: true,
            isError: false,
            result: value,
          },
        });
        runNextTick(() => {
          proccessChannel(channel);
        });
      })
      .catch((error) => {
        removeTaskFromInProgress();
        sendEvent({
          task: task,
          channel: channel,
          event: {
            type: "TASK_COMPLETED",
            channel,
            task,
            isSuccess: false,
            isError: true,
            result: error,
          },
        });
        runNextTick(() => {
          proccessChannel(channel);
        });
      });
    return;
  }
  removeTaskFromInProgress();
  sendEvent({
    task: task,
    channel: channel,
    event: {
      type: "TASK_COMPLETED",
      channel,
      task,
      isSuccess: true,
      isError: false,
      result,
    },
  });
  runNextTick(() => {
    proccessChannel(channel);
  });
  return;
};

export const addTaskToChannelExclusively = <T>(options: {
  channel: Channel;
  task: () => T;
  priority?: number;
  eventHandler?: (event: ChannelTaskEvent) => void;
}): Promise<ChannelTaskResult<Awaited<T>>> => {
  if (options.channel.tasksInQueue.length) {
    cancelAllChannelTasks(options.channel);
  }
  return addTaskToChannel(options);
};

export const addTaskToChannelIfEmpty = <T>(options: {
  channel: Channel;
  task: () => T;
  priority?: number;
  eventHandler?: (event: ChannelTaskEvent) => void;
}): Promise<ChannelTaskResult<Awaited<T>>> => {
  if (options.channel.tasksInQueue.length) {
    return Promise.resolve({
      isCancelation: true,
      isSuccess: false,
      isError: false,
      result: undefined,
      error: undefined,
    });
  }
  return addTaskToChannel(options);
};
