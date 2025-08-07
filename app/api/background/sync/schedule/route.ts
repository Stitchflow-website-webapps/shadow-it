import { NextRequest, NextResponse } from 'next/server';
import { QStashService, createSlaveToProdSyncSchedule, triggerManualSync } from '../../../../../lib/qstash';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, scheduleId, baseUrl } = body;

    const qstash = new QStashService();
    
    // Determine base URL if not provided
    const finalBaseUrl = baseUrl || `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    switch (action) {
      case 'create':
        console.log('🕐 Creating slave-to-prod sync schedule...');
        const newScheduleId = await createSlaveToProdSyncSchedule(finalBaseUrl);
        return NextResponse.json({
          success: true,
          message: 'Sync schedule created successfully',
          scheduleId: newScheduleId,
          schedule: {
            cron: '0 */6 * * *',
            description: 'Runs every 6 hours',
            url: `${finalBaseUrl}/api/background/sync/slave-to-prod`
          }
        });

      case 'delete':
        if (!scheduleId) {
          return NextResponse.json({ error: 'Schedule ID is required for delete action' }, { status: 400 });
        }
        console.log('🗑️ Deleting sync schedule:', scheduleId);
        await qstash.deleteSchedule(scheduleId);
        return NextResponse.json({
          success: true,
          message: 'Sync schedule deleted successfully'
        });

      case 'pause':
        if (!scheduleId) {
          return NextResponse.json({ error: 'Schedule ID is required for pause action' }, { status: 400 });
        }
        console.log('⏸️ Pausing sync schedule:', scheduleId);
        await qstash.pauseSchedule(scheduleId);
        return NextResponse.json({
          success: true,
          message: 'Sync schedule paused successfully'
        });

      case 'resume':
        if (!scheduleId) {
          return NextResponse.json({ error: 'Schedule ID is required for resume action' }, { status: 400 });
        }
        console.log('▶️ Resuming sync schedule:', scheduleId);
        await qstash.resumeSchedule(scheduleId);
        return NextResponse.json({
          success: true,
          message: 'Sync schedule resumed successfully'
        });

      case 'trigger-manual':
        console.log('🚀 Triggering manual sync...');
        const result = await triggerManualSync(finalBaseUrl);
        return NextResponse.json({
          success: true,
          message: 'Manual sync triggered successfully',
          messageId: result.messageId
        });

      default:
        return NextResponse.json({ error: 'Invalid action. Use: create, delete, pause, resume, or trigger-manual' }, { status: 400 });
    }

  } catch (error) {
    console.error('❌ Error managing sync schedule:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to manage sync schedule',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const qstash = new QStashService();
    const schedules = await qstash.listSchedules();
    
    // Filter for slave-to-prod sync schedules
    const syncSchedules = schedules.filter((schedule: any) => 
      schedule.destination?.includes('/api/background/sync/slave-to-prod')
    );

    return NextResponse.json({
      success: true,
      schedules: syncSchedules,
      total: syncSchedules.length
    });

  } catch (error) {
    console.error('❌ Error fetching sync schedules:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch sync schedules',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
} 