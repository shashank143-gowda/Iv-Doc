using System.Threading.Channels;
using IVDoc.Application;

namespace IVDoc.Infrastructure;

public sealed class InMemoryProcessingQueue : IProcessingQueue
{
    private readonly Channel<string> _queue = Channel.CreateUnbounded<string>(new UnboundedChannelOptions
    {
        SingleReader = false,
        SingleWriter = false,
    });

    public ValueTask EnqueueAsync(string jobId, CancellationToken cancellationToken)
        => _queue.Writer.WriteAsync(jobId, cancellationToken);

    public ValueTask<string> DequeueAsync(CancellationToken cancellationToken)
        => _queue.Reader.ReadAsync(cancellationToken);
}
