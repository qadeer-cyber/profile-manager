// Classify getUserMedia failures without inventing devices.
export function classifyMediaCaptureError(errorName, { cameraState = null, microphoneState = null } = {}) {
  const name = String(errorName || '');
  const camDenied = cameraState === 'denied';
  const micDenied = microphoneState === 'denied';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      kind: 'permission_denied',
      errorName: name,
      summary: camDenied || micDenied
        ? 'Capture was blocked by the configured camera or microphone permission.'
        : 'Capture was blocked by the browser permission state.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      kind: 'no_device',
      errorName: name,
      summary: camDenied || micDenied
        ? 'No capture stream was returned. The host reports no device and permissions are denied; this is not a substitute device list.'
        : 'No capture device is available on this host. Device enumeration is still the browser’s own list.',
    };
  }
  if (name === 'NotReadableError') {
    return { kind: 'device_busy', errorName: name, summary: 'A device exists but could not be opened.' };
  }
  if (name === 'granted' || name === 'OK') {
    return { kind: 'granted', errorName: name, summary: 'A stream was granted.' };
  }
  return { kind: 'other', errorName: name || 'unknown', summary: 'Capture did not succeed.' };
}
