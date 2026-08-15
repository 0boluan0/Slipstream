// The main process and renderer adapters load the same module-syntax-free
// implementation, which Vite can also serve directly during development.
import './endpoint-location-universal.js';

const endpointLocation = globalThis[Symbol.for('slipstream.endpoint-location')];

export const {
  ENDPOINT_LOCATION_KINDS,
  ENDPOINT_UI_LOCATIONS,
  PROCESSING_LOCATION_KINDS,
  classifyEndpointLocation,
  endpointLocationForUi,
  isHttpLoopbackEndpoint,
  processingLocationForSettings,
} = endpointLocation;

export default endpointLocation;
