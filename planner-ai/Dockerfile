# Planner AI (study planner RAG + previous-year paper reading) for a Hugging Face Docker Space.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# OpenCV (used by RapidOCR) needs these system libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Spaces run the app as user 1000.
RUN useradd -m -u 1000 user
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
# Download the OCR models into the image, so the first scanned paper does not wait for them.
RUN python -c "from papers.extract import _ocr; _ocr()" \
    && mkdir -p /app/.cache \
    && chown -R user:user /app

USER user
EXPOSE 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
