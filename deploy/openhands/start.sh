#!/bin/bash

# 1. Запускаем Docker Daemon в фоновом режиме
echo "Starting Docker Daemon..."
dockerd > /var/log/dockerd.log 2>&1 &

# 2. Ждем, пока Docker проснется
echo "Waiting for Docker to start..."
while (! docker info > /dev/null 2>&1); do
  echo -n "."
  sleep 1
done
echo "Docker is up and running!"

# 3. Настраиваем права на сокет (чтобы OpenHands мог к нему обращаться)
chmod 666 /var/run/docker.sock

# 4. Запускаем OpenHands
echo "Starting OpenHands..."
# Передаем управление оригинальной точке входа или запускаем python модуль
# В образе all-in-one это часто 'python -m openhands.core.main' или supervisord
exec python -m openhands.server.listen --host 0.0.0.0 --port $PORT
