import type { ReceiveData, RequestProps } from '@vkontakte/vk-bridge';
import type { MiniBridge } from '../../client/types.js';
import type { ApiWaitOptions } from '../lifecycle/types.js';

export type BridgeTransport = Pick<MiniBridge, 'send' | 'on' | 'supports'> & {
  callApi: (
    props: RequestProps<'VKWebAppCallAPIMethod'>,
    wait: ApiWaitOptions,
    prepare: () => void,
  ) => Promise<ReceiveData<'VKWebAppCallAPIMethod'>>;
};
