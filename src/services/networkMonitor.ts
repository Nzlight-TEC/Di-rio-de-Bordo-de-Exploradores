import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { CONNECTIVITY_CHECK_INTERVAL_MS } from '../constants';
import { recordNetworkState } from '../storage/database';
import type { NetworkSnapshot } from '../types';

export type NetworkSubscription = {
  unsubscribe: () => void;
};

export function subscribeToNetworkMonitor(
  onChange: (snapshot: NetworkSnapshot) => void,
  onError: (error: Error) => void
): NetworkSubscription {
  let disposed = false;
  let previousOnline: boolean | null = null;

  const publish = async (state: NetInfoState) => {
    try {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      const snapshot = await recordNetworkState(online, state.type ?? null);

      if (!disposed) {
        onChange(snapshot);
      }

      previousOnline = online;
    } catch (error) {
      onError(error instanceof Error ? error : new Error('Erro ao registrar conectividade.'));
    }
  };

  NetInfo.fetch().then(publish).catch((error) => {
    onError(error instanceof Error ? error : new Error('Erro ao verificar conectividade.'));
  });

  const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    void publish(state);
  });

  const interval = setInterval(() => {
    NetInfo.fetch()
      .then((state) => {
        const online = Boolean(state.isConnected && state.isInternetReachable !== false);

        if (previousOnline === null || previousOnline !== online) {
          void publish(state);
        }
      })
      .catch((error) => {
        onError(error instanceof Error ? error : new Error('Erro ao verificar conectividade.'));
      });
  }, CONNECTIVITY_CHECK_INTERVAL_MS);

  return {
    unsubscribe: () => {
      disposed = true;
      unsubscribeNetInfo();
      clearInterval(interval);
    }
  };
}
