-- CreateEnum
CREATE TYPE "UiThemeMode" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "UiLocale" AS ENUM ('es', 'en');

-- CreateTable
CREATE TABLE "user_ui_preferences" (
    "userId" TEXT NOT NULL,
    "locale" "UiLocale",
    "themeMode" "UiThemeMode" NOT NULL DEFAULT 'SYSTEM',
    "primaryColor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ui_preferences_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "user_ui_preferences" ADD CONSTRAINT "user_ui_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

