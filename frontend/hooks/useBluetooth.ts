import { useEffect, useState, useRef } from 'react';
import { Platform } from 'react-native';

type BtState = 'unknown' | 'on' | 'off' | 'unauthorized';

export function useBluetooth() {
  const [btState, setBtState] = useState<BtState>('unknown');
  const managerRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setBtState('on'); // Web: no native BT check — allow through
      return;
    }

    // Lazy import so the module isn't loaded on web.
    // Wrapped in try/catch because react-native-ble-plx requires a custom
    // dev client — it is not available in standard Expo Go.
    let BleManager: any, State: any;
    try {
      ({ BleManager, State } = require('react-native-ble-plx'));
    } catch {
      console.warn('[BT] react-native-ble-plx not available — requires custom dev client');
      setBtState('off');
      return;
    }

    const manager = new BleManager();
    managerRef.current = manager;

    const sub = manager.onStateChange((state: string) => {
      if (state === State.PoweredOn)        setBtState('on');
      else if (state === State.Unauthorized) setBtState('unauthorized');
      else                                   setBtState('off');
    }, true); // true = emit current state immediately

    return () => {
      sub.remove();
      manager.destroy();
    };
  }, []);

  return { btState };
}
