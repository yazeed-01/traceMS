FROM python:3.12-slim
WORKDIR /app
COPY requirements-common.txt .
RUN pip install --no-cache-dir -r requirements-common.txt
COPY shared/ ./shared/
COPY microservices/transformer/ ./
ENV PYTHONPATH=/app
EXPOSE 8002
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
