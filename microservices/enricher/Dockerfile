FROM python:3.12-slim
WORKDIR /app
COPY requirements-common.txt .
RUN pip install --no-cache-dir -r requirements-common.txt
COPY shared/ ./shared/
COPY microservices/enricher/ ./
ENV PYTHONPATH=/app
EXPOSE 8003
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
