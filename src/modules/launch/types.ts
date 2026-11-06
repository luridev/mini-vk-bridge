import type { ReceiveData } from '@vkontakte/vk-bridge';

export type LaunchParams = Readonly<ReceiveData<'VKWebAppGetLaunchParams'>>;

export type MiniBridgeLaunch = {
  readonly rawQuery: string;
  query: () => URLSearchParams;
  get: (options?: { refresh?: boolean }) => Promise<LaunchParams>;
};

export type LaunchState = {
  launch: MiniBridgeLaunch;
  snapshot: () => LaunchParams | undefined;
};
