use redis::AsyncCommands;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use crate::error::Result;

/// Polls `stream_outbox` for unpublished events and pushes them to Redis Streams.
pub struct OutboxPublisher {
    pool: PgPool,
    redis_url: String,
}

#[derive(Debug, sqlx::FromRow)]
struct OutboxRow {
    id: uuid::Uuid,
    stream_name: String,
    payload: serde_json::Value,
}

impl OutboxPublisher {
    pub fn new(pool: PgPool, redis_url: String) -> Self {
        Self { pool, redis_url }
    }

    pub async fn run(&self, cancel: CancellationToken) {
        info!("outbox publisher started");

        let client = match redis::Client::open(self.redis_url.as_str()) {
            Ok(c) => c,
            Err(e) => {
                error!(error = %e, "failed to create Redis client");
                return;
            }
        };

        let mut conn = match client.get_multiplexed_async_connection().await {
            Ok(c) => c,
            Err(e) => {
                error!(error = %e, "failed to connect to Redis");
                return;
            }
        };

        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    info!("outbox publisher shutting down");
                    return;
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                    if let Err(e) = self.publish_pending(&mut conn).await {
                        warn!(error = %e, "outbox publish cycle failed");
                    }
                }
            }
        }
    }

    async fn publish_pending(&self, conn: &mut redis::aio::MultiplexedConnection) -> Result<()> {
        let rows = sqlx::query_as::<_, OutboxRow>(
            "SELECT id, stream_name, payload FROM stream_outbox WHERE published = false ORDER BY created_at LIMIT 100",
        )
        .fetch_all(&self.pool)
        .await?;

        for row in rows {
            let payload_str = serde_json::to_string(&row.payload)?;

            // XADD <stream> * payload <json>
            let _: String = conn
                .xadd(&row.stream_name, "*", &[("payload", payload_str.as_str())])
                .await?;

            sqlx::query("UPDATE stream_outbox SET published = true WHERE id = $1")
                .bind(row.id)
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }
}
