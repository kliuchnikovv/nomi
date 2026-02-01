/**
 * Polyfills for AI SDK 5 in React Native.
 * Web Streams API (TransformStream, ReadableStream, WritableStream) and related
 * globals are not available in Hermes/JSC; they are required by the AI SDK and
 * eventsource-parser. Must be imported at the very top of the app entry point.
 */
const { Platform } = require('react-native');

if (Platform.OS !== 'web') {
  const { TransformStream, ReadableStream, WritableStream } = require('web-streams-polyfill');
  const structuredClone = require('@ungap/structured-clone');
  const { TextEncoderStream, TextDecoderStream } = require('@stardazed/streams-text-encoding');

  if (typeof global.structuredClone === 'undefined') {
    global.structuredClone = structuredClone;
  }
  if (typeof global.TransformStream === 'undefined') {
    global.TransformStream = TransformStream;
  }
  if (typeof global.ReadableStream === 'undefined') {
    global.ReadableStream = ReadableStream;
  }
  if (typeof global.WritableStream === 'undefined') {
    global.WritableStream = WritableStream;
  }
  if (typeof global.TextEncoderStream === 'undefined') {
    global.TextEncoderStream = TextEncoderStream;
  }
  if (typeof global.TextDecoderStream === 'undefined') {
    global.TextDecoderStream = TextDecoderStream;
  }
}
