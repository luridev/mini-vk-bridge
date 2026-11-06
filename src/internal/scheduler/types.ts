export type QueueEntry = {
  prepare: () => void;
  dispatch: () => void;
  reject: (error: unknown) => void;
};
