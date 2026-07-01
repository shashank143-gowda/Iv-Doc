using IVDoc.Application;
using Microsoft.Extensions.DependencyInjection;
using IVDoc.Infrastructure.OpenAI;
using Microsoft.Extensions.Http.Resilience;

namespace IVDoc.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddIVDocInfrastructure(this IServiceCollection services)
    {
        services.AddSingleton<InMemoryPlatformStore>();
        services.AddSingleton<IProcessingJobStore>(sp => sp.GetRequiredService<InMemoryPlatformStore>());
        services.AddSingleton<ISessionStore>(sp => sp.GetRequiredService<InMemoryPlatformStore>());
        services.AddSingleton<IProjectStore>(sp => sp.GetRequiredService<InMemoryPlatformStore>());
        services.AddSingleton<IApiKeyStore>(sp => sp.GetRequiredService<InMemoryPlatformStore>());
        services.AddSingleton<IProcessingQueue, InMemoryProcessingQueue>();
        services.AddHttpClient<OpenAIClient>();
        services.AddTransient<IDocumentExtractionEngine, OpenAIExtractionEngine>();
        services.AddHttpClient<IWebhookDeliveryClient, WebhookDeliveryClient>();
        return services;
    }
}
