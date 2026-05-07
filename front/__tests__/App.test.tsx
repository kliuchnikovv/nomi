/**
 * @format
 *
 * Smoke test: verifies the App component mounts without a synchronous crash.
 * Async side-effects (integration loading, background tasks) are allowed to
 * fail gracefully — they are mocked or caught inside the app itself.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';

test('renders without crashing', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    // Only check synchronous render — async effects (DB init, integrations)
    // run after mount and have their own error handling within the app.
    act(() => {
        renderer = ReactTestRenderer.create(<App />);
    });
    expect(renderer).toBeTruthy();
});
