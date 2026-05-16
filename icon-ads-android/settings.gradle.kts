pluginManagement {
    repositories {
        // Mirrors Alibaba Cloud — mejor latencia desde Sudamérica
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        maven("https://maven.aliyun.com/repository/central")
        maven("https://maven.aliyun.com/repository/public")
        // Oficiales como fallback
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // Mirrors Alibaba Cloud — mejor latencia desde Sudamérica
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")   // central + jcenter unificado
        maven("https://maven.aliyun.com/repository/central")
        // Oficiales como fallback
        google()
        mavenCentral()
    }
}

rootProject.name = "IconAdsPlayer"
include(":app")
