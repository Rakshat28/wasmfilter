import { File } from 'buffer';

const file = new File([Buffer.from([0x00, 0x01])], 'corrupted.mp4', { type: 'video/mp4' });
try {
  file.stream();
  console.log('Stream works');
} catch (e) {
  console.log('Stream error:', e);
}
