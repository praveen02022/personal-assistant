-- CreateTable
CREATE TABLE "VoicePreference" (
    "userId" UUID NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'auto',
    "sttProvider" TEXT NOT NULL DEFAULT 'azure',
    "ttsProvider" TEXT NOT NULL DEFAULT 'azure',
    "voiceEn" TEXT NOT NULL DEFAULT 'en-IN-NeerjaNeural',
    "voiceTa" TEXT NOT NULL DEFAULT 'ta-IN-PallaviNeural',
    "speechRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "autoSpeak" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoicePreference_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "VoicePreference" ADD CONSTRAINT "VoicePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
