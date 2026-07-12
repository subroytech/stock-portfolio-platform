import env from './config/env';
import app from './app';

app.listen(env.port, () => {
  console.log(`Backend listening on port ${env.port}`);
});
