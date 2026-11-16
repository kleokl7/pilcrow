plugins {
    id("com.android.application")
}

android {
    namespace = "dev.pilcrow.editor"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.pilcrow.editor"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.core:core-ktx:1.19.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}

// The web editor is built by npm into app/src/main/assets/editor before every Android build.
val editorDir = rootProject.layout.projectDirectory.dir("editor")
val buildEditor = tasks.register<Exec>("buildEditor") {
    workingDir = editorDir.asFile
    commandLine("npm", "run", "build")
    inputs.dir(editorDir.dir("src"))
    inputs.files(editorDir.file("index.html"), editorDir.file("package.json"), editorDir.file("build.mjs"))
    outputs.dir(layout.projectDirectory.dir("src/main/assets/editor"))
}
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(buildEditor) }
