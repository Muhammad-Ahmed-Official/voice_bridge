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

    // Lazy import so the module isn't loaded on web
    const { BleManager, State } = require('react-native-ble-plx');
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
