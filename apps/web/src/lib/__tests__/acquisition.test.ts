import { beforeEach, describe, expect, it } from 'vitest';
import { captureAcquisitionFromSearch, clearAcquisition, readAcquisition, rememberAcquisition } from '../acquisition';

describe('acquisition source', () => {
  beforeEach(() => clearAcquisition());

  it('remembers the first source and keeps it', () => {
    rememberAcquisition('steve-dangle', { landing: '/dangle' });
    rememberAcquisition('google', { landing: '/' });
    expect(readAcquisition()?.source).toBe('steve-dangle');
    expect(readAcquisition()?.landing).toBe('/dangle');
  });

  it('captures utm parameters from a query string', () => {
    captureAcquisitionFromSearch('?utm_source=Podcast&utm_campaign=SDP&utm_medium=audio', '/opening-night');
    expect(readAcquisition()).toMatchObject({ source: 'podcast', campaign: 'sdp', medium: 'audio', landing: '/opening-night' });
  });

  it('ignores a query string without a source', () => {
    expect(captureAcquisitionFromSearch('?tab=join', '/create-league')).toBeNull();
    expect(readAcquisition()).toBeNull();
  });

  it('accepts ref= as a short form', () => {
    captureAcquisitionFromSearch('?ref=dangle', '/');
    expect(readAcquisition()?.source).toBe('dangle');
  });
});
