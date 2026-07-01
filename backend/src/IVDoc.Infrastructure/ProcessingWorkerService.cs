using IVDoc.Application;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace IVDoc.Infrastructure;

public sealed class ProcessingWorkerService(
    IProcessingQueue queue,
    DocumentProcessingService processor,
    ILogger<ProcessingWorkerService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            string jobId;
            try
            {
                jobId = await queue.DequeueAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            try
            {
                await processor.ProcessAsync(jobId, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Unhandled processing worker error for job {JobId}", jobId);
            }
        }
    }
}
