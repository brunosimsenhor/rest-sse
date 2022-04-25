FROM python:3.9-slim

WORKDIR /opt/server

COPY requirements.txt .

RUN pip install -r requirements.txt

COPY . .
