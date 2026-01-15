# Используем официальный образ OpenHands
FROM openhands/openhands:all-in-one

# Переключаемся на root, чтобы установить и настроить Docker внутри
USER root

# Устанавливаем Docker и sudo (если их нет в базовом образе, но обычно они нужны для DinD)
RUN apt-get update && \
    apt-get install -y docker.io sudo && \
    rm -rf /var/lib/apt/lists/*

# Копируем наш скрипт запуска
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# OpenHands работает от пользователя openhands (UID 1000)
# Нам нужно убедиться, что этот пользователь может использовать docker
RUN usermod -aG docker openhands

# Возвращаемся к пользователю openhands (или остаемся root, если скрипт требует)
# Для Railway и DinD часто проще стартовать от root и понижать права, 
# но попробуем запуск через скрипт.
USER root

ENTRYPOINT ["/app/start.sh"]
