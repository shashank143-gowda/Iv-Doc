using IVDoc.Application;
using IVDoc.Domain;
using IVDoc.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddSingleton<ValidationShield>();
builder.Services.AddSingleton<PageSegmentationService>();
builder.Services.AddSingleton<PackageValidationService>();
builder.Services.AddSingleton<DocumentProcessingService>();
builder.Services.AddIVDocInfrastructure();
builder.Services.AddHostedService<ProcessingWorkerService>();

await builder.Build().RunAsync();
