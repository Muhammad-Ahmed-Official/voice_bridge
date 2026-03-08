import { useState, useCallback, useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';

export type ClassicBluetoothDevice = {
  name: string | null;
  address: string;
};

const isAndroid = Platform.OS === 'android';

const DISCOVERY_TIMEOUT_MS = 15000;

async function requestClassicBluetoothPermissions(): Promise<boolean> {
  if (!isAndroid) return false;
  try {
    const apiLevel = (Platform as any).Version ?? 0;
    if (apiLevel >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      const granted =
        result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
        result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
        result['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;
      return granted;
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function deviceToPlain(d: { name?: string | null; address: string }): ClassicBluetoothDevice {
  return {
    name: d.name ?? null,
    address: d.address,
  };
}

export function useBluetoothClassic() {
  const [classicDevices, setClassicDevices] = useState<ClassicBluetoothDevice[]>([]);
  const [bondedDevices, setBondedDevices] = useState<ClassicBluetoothDevice[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [classicError, setClassicError] = useState<string | null>(null);
  const [pairingAddress, setPairingAddress] = useState<string | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [classicAvailable, setClassicAvailable] = useState(false);
  const discoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAndroid) return;
    let mounted = true;
    try {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;
      RNBluetoothClassic.isBluetoothAvailable()
        .then((available: boolean) => {
          if (mounted) setClassicAvailable(available);
        })
        .catch(() => {
          if (mounted) setClassicAvailable(false);
        });
    } catch {
      setClassicAvailable(false);
    }
    return () => { mounted = false; };
  }, []);

  const refreshBonded = useCallback(async () => {
    if (!isAndroid) return;
    try {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;
      const bonded = await RNBluetoothClassic.getBondedDevices();
      setBondedDevices(Array.isArray(bonded) ? bonded.map(deviceToPlain) : []);
    } catch {
      setBondedDevices([]);
    }
  }, []);

  useEffect(() => {
    if (classicAvailable) refreshBonded();
  }, [classicAvailable, refreshBonded]);

  const startClassicDiscovery = useCallback(async () => {
    if (!isAndroid || !classicAvailable) {
      setClassicError('Classic Bluetooth is only available on Android (development build).');
      return;
    }
    const hasPermission = await requestClassicBluetoothPermissions();
    if (!hasPermission) {
      setClassicError('Bluetooth and Location permissions are required to find nearby phones.');
      return;
    }
    try {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;
      const enabled = await RNBluetoothClassic.isBluetoothEnabled();
      if (!enabled) {
        await RNBluetoothClassic.requestBluetoothEnabled();
      }
      setClassicError(null);
      setPairError(null);
      setClassicDevices([]);
      setIsDiscovering(true);

      const discoveryPromise = RNBluetoothClassic.startDiscovery();

      discoveryTimeoutRef.current = setTimeout(async () => {
        try {
          await RNBluetoothClassic.cancelDiscovery();
        } catch (_) {}
        discoveryTimeoutRef.current = null;
      }, DISCOVERY_TIMEOUT_MS);

      const devices = await discoveryPromise;
      if (discoveryTimeoutRef.current) {
        clearTimeout(discoveryTimeoutRef.current);
        discoveryTimeoutRef.current = null;
      }
      setClassicDevices(Array.isArray(devices) ? devices.map(deviceToPlain) : []);
      await refreshBonded();
    } catch (e: any) {
      setClassicError(e?.message ?? 'Discovery failed.');
    } finally {
      setIsDiscovering(false);
    }
  }, [classicAvailable, refreshBonded]);

  const stopClassicDiscovery = useCallback(async () => {
    if (!isAndroid) return;
    if (discoveryTimeoutRef.current) {
      clearTimeout(discoveryTimeoutRef.current);
      discoveryTimeoutRef.current = null;
    }
    try {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;
      await RNBluetoothClassic.cancelDiscovery();
    } catch (_) {}
    setIsDiscovering(false);
  }, []);

  const pairDevice = useCallback(async (address: string) => {
    if (!isAndroid || !classicAvailable) return;
    setPairError(null);
    setPairingAddress(address);
    try {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;
      await RNBluetoothClassic.pairDevice(address);
      await refreshBonded();
    } catch (e: any) {
      setPairError(e?.message ?? 'Pairing failed. The other user may need to accept on their phone.');
    } finally {
      setPairingAddress(null);
    }
  }, [classicAvailable, refreshBonded]);

  useEffect(() => {
    return () => {
      if (discoveryTimeoutRef.current) clearTimeout(discoveryTimeoutRef.current);
      stopClassicDiscovery();
    };
  }, [stopClassicDiscovery]);

  return {
    classicAvailable: isAndroid && classicAvailable,
    classicDevices,
    bondedDevices,
    isDiscovering,
    classicError,
    pairingAddress,
    pairError,
    startClassicDiscovery,
    stopClassicDiscovery,
    pairDevice,
    refreshBonded,
  };
}
