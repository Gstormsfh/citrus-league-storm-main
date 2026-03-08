# Citrus Fantasy Sports — Data Pipeline Container
#
# Runs the NHL data scraping, live scoring, and nightly projection pipeline.
# Includes health check endpoint for monitoring integration.
#
# Build:
#   docker build -t citrus-pipeline ./data-pipeline
#
# Run:
#   docker run --env-file .env -p 8888:8888 citrus-pipeline
#
# Health check:
#   curl http://localhost:8888/health

FROM python:3.11-slim

LABEL maintainer="Citrus Fantasy Sports"
LABEL description="NHL data pipeline — scraping, projections, live scoring"

# Install system dependencies for psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash citrus
RUN chown -R citrus:citrus /app /tmp
USER citrus

# Health check — verify pipeline responsiveness
HEALTHCHECK --interval=60s --timeout=5s --retries=3 --start-period=30s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8888/health')" || exit 1

# Expose health check port
EXPOSE 8888

# Default: start the health check server alongside the main pipeline
# Override CMD for specific pipeline tasks (e.g., nightly projections only)
CMD ["python", "-m", "data_pipeline.monitoring.health_check_server"]
