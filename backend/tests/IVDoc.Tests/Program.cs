using IVDoc.Application;
using IVDoc.Domain;
using IVDoc.Infrastructure;

var tests = new List<(string Name, Func<Task> Run)>
{
    ("IBAN checksum passes known valid IBAN", TestIban),
    ("Required redacted field is skipped", TestRedactedRequired),
    ("Page segmentation splits on confident doc type change", TestPageSegmentation),
    ("Package validation warns on mismatched applicant names", TestPackageValidation),
    ("API keys authenticate and revoke", TestApiKeys),
};

var failed = 0;
foreach (var test in tests)
{
    try
    {
        await test.Run();
        Console.WriteLine($"PASS {test.Name}");
    }
    catch (Exception ex)
    {
        failed++;
        Console.WriteLine($"FAIL {test.Name}: {ex.Message}");
    }
}

if (failed > 0)
{
    Environment.ExitCode = 1;
}

static Task TestIban()
{
    var check = ValidationShield.ValidateIban("GB82 WEST 1234 5698 7654 32");
    AssertEqual(ValidationStatus.Pass, check.Status);
    return Task.CompletedTask;
}

static Task TestRedactedRequired()
{
    var details = new Dictionary<string, FieldDetail>(StringComparer.OrdinalIgnoreCase)
    {
        ["iban"] = new("redacted", null, 2, 0.99),
    };
    var checks = ValidationShield.ValidateRequired(new Dictionary<string, object?>(), ["iban"], details);
    AssertEqual(ValidationStatus.Skipped, checks[0].Status);
    AssertContains("Redacted", checks[0].Detail);
    return Task.CompletedTask;
}

static Task TestPageSegmentation()
{
    var stitcher = new PageSegmentationService();
    var segments = stitcher.StitchSegments([
        new PageMeta { Page = 1, DocumentType = "loan_contract", SegmentRole = "start", Confidence = 0.9 },
        new PageMeta { Page = 2, DocumentType = "loan_contract", SegmentRole = "end", Confidence = 0.88 },
        new PageMeta { Page = 3, DocumentType = "payment_schedule", SegmentRole = "start", Confidence = 0.92 },
    ]);
    AssertEqual(2, segments.Count);
    AssertEqual("loan_contract", segments[0].DocType);
    AssertEqual("payment_schedule", segments[1].DocType);
    return Task.CompletedTask;
}

static Task TestPackageValidation()
{
    var service = new PackageValidationService();
    var validation = service.RunPackageValidation([
        new ProcessedDocument
        {
            FileName = "passport.pdf",
            DocumentType = "kyc_passport",
            Fields = new Dictionary<string, object?> { ["full_name"] = "Amina Khan" },
        },
        new ProcessedDocument
        {
            FileName = "payslip.pdf",
            DocumentType = "payslip",
            Fields = new Dictionary<string, object?> { ["employee_name"] = "Omar Khan" },
        },
    ]);
    AssertEqual(Decision.ExceptionQueue, validation.Decision);
    Assert(validation.Checks.Any(c => c.Id == "pkg:name-consistency" && c.Status == ValidationStatus.Warn), "Expected name consistency warning.");
    return Task.CompletedTask;
}

static async Task TestApiKeys()
{
    var store = new InMemoryPlatformStore();
    var clock = new SystemClock();
    var service = new ApiKeyService(store, clock);
    var caller = new AuthenticatedCaller("user-1", null, "jwt", new HashSet<string>(["*"]));
    var created = await service.CreateAsync(new ApiKeyCreateRequest
    {
        ProjectId = "project-1",
        Scopes = ["jobs:write"],
    }, caller, CancellationToken.None);

    var authed = await service.AuthenticateAsync(created.Secret, CancellationToken.None);
    Assert(authed is not null, "Expected created API key to authenticate.");
    AssertEqual("project-1", authed!.ProjectId);
    Assert(authed.Scopes.Contains("jobs:write"), "Expected jobs:write scope.");

    var revoked = await service.RevokeAsync(created.Id, caller, CancellationToken.None);
    Assert(revoked, "Expected revoke to succeed.");
    var afterRevoke = await service.AuthenticateAsync(created.Secret, CancellationToken.None);
    Assert(afterRevoke is null, "Expected revoked key to stop authenticating.");
}

static void Assert(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}

static void AssertEqual<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
    {
        throw new InvalidOperationException($"Expected '{expected}', got '{actual}'.");
    }
}

static void AssertContains(string expected, string? actual)
{
    if (actual is null || !actual.Contains(expected, StringComparison.OrdinalIgnoreCase))
    {
        throw new InvalidOperationException($"Expected '{actual}' to contain '{expected}'.");
    }
}
