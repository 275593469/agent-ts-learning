// 学习目标：任务执行进度
// 长任务（如批量分析）需要让前端实时看到进度：用事件 + 订阅模型实现。

export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface TaskEvent {
  taskId: string;
  step: string;
  status: TaskStatus;
  /** 0 - 100 */
  progress: number;
  message: string;
  timestamp: string;
}

export type TaskListener = (event: TaskEvent) => void;

export class TaskStore {
  private readonly events = new Map<string, TaskEvent[]>();
  private readonly listeners = new Map<string, Set<TaskListener>>();

  create(taskId: string): void {
    this.events.set(taskId, []);
  }

  emit(taskId: string, event: Omit<TaskEvent, "taskId" | "timestamp">): TaskEvent {
    const full: TaskEvent = {
      ...event,
      taskId,
      timestamp: new Date().toISOString(),
    };

    const list = this.events.get(taskId) ?? [];
    list.push(full);
    this.events.set(taskId, list);

    for (const listener of this.listeners.get(taskId) ?? []) {
      listener(full);
    }

    return full;
  }

  /** 订阅某任务的进度事件，返回取消订阅函数 */
  subscribe(taskId: string, listener: TaskListener): () => void {
    const set = this.listeners.get(taskId) ?? new Set<TaskListener>();
    set.add(listener);
    this.listeners.set(taskId, set);

    // 回放历史事件，避免订阅之前产生的进度丢失
    for (const event of this.events.get(taskId) ?? []) {
      listener(event);
    }

    return () => {
      set.delete(listener);
    };
  }

  history(taskId: string): TaskEvent[] {
    return this.events.get(taskId) ?? [];
  }
}

export const taskStore = new TaskStore();
