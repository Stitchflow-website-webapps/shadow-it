import { Client } from "@upstash/qstash";

// Initialize QStash client
const qstashClient = new Client({
  token: process.env.QSTASH_TOKEN!,
});

export interface ScheduleOptions {
  cron: string;
  url: string;
  body?: any;
  headers?: Record<string, string>;
  retries?: number;
}

export class QStashService {
  private client: Client;

  constructor() {
    if (!process.env.QSTASH_TOKEN) {
      throw new Error('QSTASH_TOKEN environment variable is required');
    }
    this.client = qstashClient;
  }

  /**
   * Schedule a recurring job using cron expression
   */
  async scheduleRecurringJob(options: ScheduleOptions): Promise<string> {
    try {
      const response = await this.client.schedules.create({
        cron: options.cron,
        destination: options.url,
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        retries: options.retries || 3,
      });

      console.log('✅ QStash schedule created:', response);
      return response.scheduleId;
    } catch (error) {
      console.error('❌ Failed to create QStash schedule:', error);
      throw error;
    }
  }

  /**
   * Delete a scheduled job
   */
  async deleteSchedule(scheduleId: string): Promise<void> {
    try {
      await this.client.schedules.delete(scheduleId);
      console.log('✅ QStash schedule deleted:', scheduleId);
    } catch (error) {
      console.error('❌ Failed to delete QStash schedule:', error);
      throw error;
    }
  }

  /**
   * List all scheduled jobs
   */
  async listSchedules() {
    try {
      const schedules = await this.client.schedules.list();
      return schedules;
    } catch (error) {
      console.error('❌ Failed to list QStash schedules:', error);
      throw error;
    }
  }

  /**
   * Get a specific schedule
   */
  async getSchedule(scheduleId: string) {
    try {
      const schedule = await this.client.schedules.get(scheduleId);
      return schedule;
    } catch (error) {
      console.error('❌ Failed to get QStash schedule:', error);
      throw error;
    }
  }

  /**
   * Pause a scheduled job
   */
  async pauseSchedule(scheduleId: string): Promise<void> {
    try {
      await this.client.schedules.pause(scheduleId);
      console.log('⏸️ QStash schedule paused:', scheduleId);
    } catch (error) {
      console.error('❌ Failed to pause QStash schedule:', error);
      throw error;
    }
  }

  /**
   * Resume a scheduled job
   */
  async resumeSchedule(scheduleId: string): Promise<void> {
    try {
      await this.client.schedules.resume(scheduleId);
      console.log('▶️ QStash schedule resumed:', scheduleId);
    } catch (error) {
      console.error('❌ Failed to resume QStash schedule:', error);
      throw error;
    }
  }

  /**
   * Send a one-time message
   */
  async publishMessage(url: string, body?: any, headers?: Record<string, string>) {
    try {
      const response = await this.client.publishJSON({
        url,
        body: body || {},
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      console.log('✅ QStash message published:', response);
      return response;
    } catch (error) {
      console.error('❌ Failed to publish QStash message:', error);
      throw error;
    }
  }
}

// Utility function to create the slave-to-prod sync schedule
export async function createSlaveToProdSyncSchedule(baseUrl: string): Promise<string> {
  const qstash = new QStashService();
  
  // Run every 6 hours: "0 */6 * * *"
  const scheduleId = await qstash.scheduleRecurringJob({
    cron: "0 */6 * * *", // Every 6 hours at minute 0
    url: `${baseUrl}/api/background/sync/slave-to-prod`,
    headers: {
      'x-scheduled-sync': 'true',
    },
    retries: 2, // Retry failed syncs up to 2 times
  });

  return scheduleId;
}

// Utility function to trigger a manual sync
export async function triggerManualSync(baseUrl: string) {
  const qstash = new QStashService();
  
  return await qstash.publishMessage(
    `${baseUrl}/api/background/sync/slave-to-prod`,
    {},
    {
      'x-manual-trigger': 'true',
    }
  );
} 